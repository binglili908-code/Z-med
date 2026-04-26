import { buildSpotlightPapers } from "@/lib/spotlight";
import {
  getWeeklySpotlightEmailSubject,
  sendSpotlightDigestEmail,
} from "@/lib/spotlight-email";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  createProcessingSpotlightDelivery,
  deleteSpotlightDelivery,
  listWeeklySpotlightProfiles,
  loadExistingSpotlightDelivery,
  markSpotlightDeliveryFailed,
  markSpotlightDeliverySent,
  type SpotlightTriggerSource,
} from "@/server/repositories/weekly-spotlight-email";

type TriggerSource = SpotlightTriggerSource;

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

export async function runWeeklySpotlightEmailJob(options: RunWeeklySpotlightEmailJobOptions = {}) {
  const service = createServiceSupabaseClient();
  const issueWeekStart = normalizeWeekStart(options.issueWeekStart);
  const limit = normalizeLimit(options.limit);
  const dryRun = options.dryRun === true;
  const retryFailed = options.retryFailed === true;
  const triggerSource = options.triggerSource ?? "cron";

  const profiles = await listWeeklySpotlightProfiles(service, {
    userId: options.userId,
    email: options.email,
    limit,
  });

  const results: UserRunResult[] = [];
  let sentCount = 0;
  let skippedRepeatedUsers = 0;
  let skippedProcessingUsers = 0;
  let skippedFailedUsers = 0;
  let failedCount = 0;

  for (const profile of profiles) {
    const emailTo = String(profile.contact_email ?? "").trim();
    if (!emailTo) continue;

    if (!dryRun) {
      const existing = await loadExistingSpotlightDelivery(service, {
        userId: profile.id,
        issueWeekStart,
      });
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
        await deleteSpotlightDelivery(service, existing.id);
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

    const deliveryId = await createProcessingSpotlightDelivery(service, {
      userId: profile.id,
      emailTo,
      issueWeekStart,
      triggerSource,
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
        intro: "这是基于您当前首页推荐生成的本周 7 篇精选邮件，内容与首页保持同源，并按您的订阅偏好个性化排序。",
      });

      await markSpotlightDeliverySent(service, {
        deliveryId,
        emailTo,
        paperIds,
        triggerSource,
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
      await markSpotlightDeliveryFailed(service, {
        deliveryId,
        errorMessage: message,
      });
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
    targetCount: profiles.length,
    processedCount: results.length,
    sentCount,
    skippedRepeatedUsers,
    skippedProcessingUsers,
    skippedFailedUsers,
    failedCount,
    results,
  };
}
