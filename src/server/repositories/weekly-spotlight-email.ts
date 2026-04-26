import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type WeeklySpotlightProfileRow = {
  id: string;
  contact_email: string | null;
  is_active: boolean | null;
};

export type SpotlightDeliveryStatus = "processing" | "sent" | "failed";
export type SpotlightTriggerSource = "cron" | "manual";

export type SpotlightDeliveryRow = {
  id: string;
  status: SpotlightDeliveryStatus;
  last_error: string | null;
};

export async function listWeeklySpotlightProfiles(
  client: SupabaseDbClient,
  filters: { userId?: string | null; email?: string | null; limit?: number | null },
) {
  let query = client
    .from("profiles")
    .select("id,contact_email,is_active")
    .eq("is_active", true)
    .not("contact_email", "is", null);

  if (filters.userId?.trim()) {
    query = query.eq("id", filters.userId.trim());
  }
  if (filters.email?.trim()) {
    query = query.eq("contact_email", filters.email.trim());
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Load active profiles failed: ${error.message}`);
  }

  return (data ?? []) as WeeklySpotlightProfileRow[];
}

export async function loadExistingSpotlightDelivery(
  client: SupabaseDbClient,
  input: { userId: string; issueWeekStart: string },
) {
  const { data, error } = await client
    .from("user_weekly_spotlight_deliveries")
    .select("id,status,last_error")
    .eq("user_id", input.userId)
    .eq("issue_week_start", input.issueWeekStart)
    .maybeSingle();
  if (error) {
    throw new Error(`Load spotlight delivery failed: ${error.message}`);
  }

  return (data as SpotlightDeliveryRow | null) ?? null;
}

export async function createProcessingSpotlightDelivery(
  client: SupabaseDbClient,
  input: {
    userId: string;
    emailTo: string;
    issueWeekStart: string;
    triggerSource: SpotlightTriggerSource;
  },
) {
  const { data, error } = await client
    .from("user_weekly_spotlight_deliveries")
    .insert({
      user_id: input.userId,
      email_to: input.emailTo,
      issue_week_start: input.issueWeekStart,
      status: "processing",
      trigger_source: input.triggerSource,
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

export async function markSpotlightDeliveryFailed(
  client: SupabaseDbClient,
  input: { deliveryId: string; errorMessage: string },
) {
  const { error } = await client
    .from("user_weekly_spotlight_deliveries")
    .update({
      status: "failed",
      last_error: input.errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.deliveryId);
  if (error) {
    throw new Error(`Update failed spotlight delivery failed: ${error.message}`);
  }
}

export async function markSpotlightDeliverySent(
  client: SupabaseDbClient,
  input: {
    deliveryId: string;
    emailTo: string;
    paperIds: string[];
    triggerSource: SpotlightTriggerSource;
  },
) {
  const sentAt = new Date().toISOString();
  const { error } = await client
    .from("user_weekly_spotlight_deliveries")
    .update({
      status: "sent",
      email_to: input.emailTo,
      spotlight_count: input.paperIds.length,
      paper_ids: input.paperIds,
      trigger_source: input.triggerSource,
      last_error: null,
      sent_at: sentAt,
      updated_at: sentAt,
    })
    .eq("id", input.deliveryId);
  if (error) {
    throw new Error(`Finalize spotlight delivery failed: ${error.message}`);
  }
}

export async function deleteSpotlightDelivery(
  client: SupabaseDbClient,
  deliveryId: string,
) {
  const { error } = await client
    .from("user_weekly_spotlight_deliveries")
    .delete()
    .eq("id", deliveryId);
  if (error) {
    throw new Error(`Delete failed spotlight delivery failed: ${error.message}`);
  }
}
