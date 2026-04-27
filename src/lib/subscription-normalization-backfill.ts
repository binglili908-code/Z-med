import { normalizeSubscriptionPreferences } from "@/lib/subscription-preference-normalizer";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  listProfilesPendingPreferenceNormalization,
  normalizeStringList,
  updateProfilePreferenceNormalization,
} from "@/server/repositories/profiles";

export async function runSubscriptionNormalizationBackfill(options?: {
  limit?: number;
}) {
  const service = createServiceSupabaseClient();
  const limit = Math.max(1, Math.min(50, Number(options?.limit ?? 10)));
  const rows = await listProfilesPendingPreferenceNormalization(service, limit);

  let normalizedCount = 0;
  let failedCount = 0;
  const results: Array<{
    userId: string;
    email: string | null;
    status: "normalized" | "failed";
    error?: string | null;
  }> = [];

  for (const row of rows) {
    if (!row.id) continue;
    const keywords = normalizeStringList(row.subscription_keywords);
    const customJournals = normalizeStringList(row.custom_journals);
    try {
      const normalized = await normalizeSubscriptionPreferences({
        keywords,
        customJournals,
      });
      if (normalized.error) {
        failedCount += 1;
        results.push({
          userId: row.id,
          email: row.contact_email ?? null,
          status: "failed",
          error: normalized.error,
        });
        continue;
      }

      await updateProfilePreferenceNormalization(service, row.id, normalized);
      normalizedCount += 1;
      results.push({
        userId: row.id,
        email: row.contact_email ?? null,
        status: "normalized",
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        userId: row.id,
        email: row.contact_email ?? null,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    scannedCount: rows.length,
    normalizedCount,
    failedCount,
    results,
  };
}
