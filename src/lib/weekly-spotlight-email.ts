import { buildSpotlightPapers } from "@/lib/spotlight";
import {
  getWeeklySpotlightEmailSubject,
  sendSpotlightDigestEmail,
} from "@/lib/spotlight-email";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type ProfileRow = {
  id: string;
  contact_email: string | null;
  is_active: boolean | null;
};

type DeliveryStatus = "processing" | "sent" | "failed";
type TriggerSource = "cron" | "manual";

type DeliveryRow = {
  id: string;
  status: DeliveryStatus;
  last_error: string | null;
};

type RunWeeklySpotlightEmailJobOptions = {
  userId?: string | null;
  email?: string | null;
  issueWeekStart?: string | null;
  limit?: number | null;
  dryRun?: boolean;
  retryFailed?: boolean;
  triggerSource?: TriggerSource;
};

type UserRunResult = {
  userId: string;
  emailTo: string;
  status:
    | "sent"
    | "dry_run"
    | "skipped_duplicate"
    | "skipped_processing"
    | "skipped_failed"
    | "failed";
  itemCount: number;
  reason?: string;
  paperIds?: string[];
};

function startOfIsoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeWeekStart(input?: string | null) {
  if (!input) return toDateString(startOfIsoWeek(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error("issueWeekStart must use YYYY-MM-DD format");
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("issueWeekStart is invalid");
  }
  return toDateString(startOfIsoWeek(parsed));
}

function normalizeLimit(limit?: number | null) {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(Math.trunc(limit), 100);
}

async function loadExistingDelivery(
  userId: string,
  issueWeekStart: string,
  service: ReturnType<typeof createServiceSupabaseClient>,
) {
  const { data, error } = await service
    .from("user_weekly_spotlight_deliveries")
    .select("id,status,last_error")
    .eq("user_id", userId)
    .eq("issue_week_start", issueWeekStart)
    .maybeSingle();
  if (error) {
    throw new Error(`Load spotlight delivery failed: ${error.message}`);
  }
  return (data as DeliveryRow | null) ?? null;
}

async function createProcessingDelivery(params: {
  userId: string;
  emailTo: string;
  issueWeekStart: string;
  triggerSource: TriggerSource;
  service: ReturnType<typeof createServiceSupabaseClient>;
}) {
  const { data, error } = await params.service
    .from("user_weekly_spotlight_deliveries")
    .insert({
      user_id: params.userId,
      email_to: params.emailTo,
      issue_week_start: params.issueWeekStart,
      status: "processing",
      trigger_source: params.triggerSource,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return null;
    }
    throw new Error(`Create spotlight delivery failed: ${error.message}`);
  }

  return data?.id ?? null;
}

async function markDeliveryFailed(
  deliveryId: string,
  errorMessage: string,
  service: ReturnType<typeof createServiceSupabaseClient>,
) {
  const { error } = await service
    .from("user_weekly_spotlight_deliveries")
    .update({
      status: "failed",
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);
  if (error) {
    throw new Error(`Update failed spotlight delivery failed: ${error.message}`);
  }
}

async function markDeliverySent(params: {
  deliveryId: string;
  emailTo: string;
  paperIds: string[];
  triggerSource: TriggerSource;
  service: ReturnType<typeof createServiceSupabaseClient>;
}) {
  const sentAt = new Date().toISOString();
  const { error } = await params.service
    .from("user_weekly_spotlight_deliveries")
    .update({
      status: "sent",
      email_to: params.emailTo,
      spotlight_count: params.paperIds.length,
      paper_ids: params.paperIds,
      trigger_source: params.triggerSource,
      last_error: null,
      sent_at: sentAt,
      updated_at: sentAt,
    })
    .eq("id", params.deliveryId);
  if (error) {
    throw new Error(`Finalize spotlight delivery failed: ${error.message}`);
  }
}

async function deleteDelivery(id: string, service: ReturnType<typeof createServiceSupabaseClient>) {
  const { error } = await service.from("user_weekly_spotlight_deliveries").delete().eq("id", id);
  if (error) {
    throw new Error(`Delete failed spotlight delivery failed: ${error.message}`);
  }
}

export async function runWeeklySpotlightEmailJob(options: RunWeeklySpotlightEmailJobOptions = {}) {
  const service = createServiceSupabaseClient();
  const issueWeekStart = normalizeWeekStart(options.issueWeekStart);
  const limit = normalizeLimit(options.limit);
  const dryRun = options.dryRun === true;
  const retryFailed = options.retryFailed === true;
  const triggerSource = options.triggerSource ?? "cron";

  let query = service
    .from("profiles")
    .select("id,contact_email,is_active")
    .eq("is_active", true)
    .not("contact_email", "is", null);

  if (options.userId?.trim()) {
    query = query.eq("id", options.userId.trim());
  }
  if (options.email?.trim()) {
    query = query.eq("contact_email", options.email.trim());
  }
  if (limit) {
    query = query.limit(limit);
  }

  const { data: profiles, error: profileErr } = await query;
  if (profileErr) {
    throw new Error(`Load active profiles failed: ${profileErr.message}`);
  }

  const results: UserRunResult[] = [];
  let sentCount = 0;
  let skippedRepeatedUsers = 0;
  let skippedProcessingUsers = 0;
  let skippedFailedUsers = 0;
  let failedCount = 0;

  for (const profile of (profiles ?? []) as ProfileRow[]) {
    const emailTo = String(profile.contact_email ?? "").trim();
    if (!emailTo) continue;

    if (!dryRun) {
      const existing = await loadExistingDelivery(profile.id, issueWeekStart, service);
      if (existing?.status === "sent") {
        skippedRepeatedUsers += 1;
        results.push({
          userId: profile.id,
          emailTo,
          status: "skipped_duplicate",
          itemCount: 0,
          reason: "same user already sent in this ISO week",
        });
        continue;
      }
      if (existing?.status === "processing") {
        skippedProcessingUsers += 1;
        results.push({
          userId: profile.id,
          emailTo,
          status: "skipped_processing",
          itemCount: 0,
          reason: "delivery already in processing state",
        });
        continue;
      }
      if (existing?.status === "failed") {
        if (!retryFailed) {
          skippedFailedUsers += 1;
          results.push({
            userId: profile.id,
            emailTo,
            status: "skipped_failed",
            itemCount: 0,
            reason: existing.last_error ?? "previous failed delivery exists",
          });
          continue;
        }
        await deleteDelivery(existing.id, service);
      }
    }

    const { items } = await buildSpotlightPapers({ userId: profile.id, service });
    const paperIds = items.map((item) => item.id);

    if (!items.length) {
      failedCount += 1;
      results.push({
        userId: profile.id,
        emailTo,
        status: "failed",
        itemCount: 0,
        reason: "No spotlight papers available",
      });
      continue;
    }

    if (dryRun) {
      results.push({
        userId: profile.id,
        emailTo,
        status: "dry_run",
        itemCount: items.length,
        paperIds,
      });
      continue;
    }

    const deliveryId = await createProcessingDelivery({
      userId: profile.id,
      emailTo,
      issueWeekStart,
      triggerSource,
      service,
    });

    if (!deliveryId) {
      skippedProcessingUsers += 1;
      results.push({
        userId: profile.id,
        emailTo,
        status: "skipped_processing",
        itemCount: 0,
        reason: "delivery claim lost due to concurrent run",
      });
      continue;
    }

    try {
      await sendSpotlightDigestEmail({
        to: emailTo,
        subject: getWeeklySpotlightEmailSubject(issueWeekStart),
        items,
        heading: "本周首页精选 7 篇文献",
        intro: "这是基于你当前首页推荐生成的本周 7 篇精选邮件，内容与首页保持同源，并按你的订阅偏好个性化排序。",
      });

      await markDeliverySent({
        deliveryId,
        emailTo,
        paperIds,
        triggerSource,
        service,
      });

      sentCount += 1;
      results.push({
        userId: profile.id,
        emailTo,
        status: "sent",
        itemCount: items.length,
        paperIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email error";
      await markDeliveryFailed(deliveryId, message, service);
      failedCount += 1;
      results.push({
        userId: profile.id,
        emailTo,
        status: "failed",
        itemCount: items.length,
        reason: message,
        paperIds,
      });
    }
  }

  return {
    issueWeekStart,
    dryRun,
    triggerSource,
    targetCount: (profiles ?? []).length,
    processedCount: results.length,
    sentCount,
    skippedRepeatedUsers,
    skippedProcessingUsers,
    skippedFailedUsers,
    failedCount,
    results,
  };
}
