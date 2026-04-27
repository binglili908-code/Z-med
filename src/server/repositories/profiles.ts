import type { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { NormalizedSubscriptionPreferences } from "@/lib/subscription-preference-normalizer";
import { isMissingColumnError } from "@/server/repositories/schema-compat";
import type {
  UserSubscription,
  UserSubscriptionSaveResponse,
} from "@/shared/contracts/subscriptions";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type ProfileSubscriptionStatus = {
  subscriptionEnabled: boolean;
  hasSubscriptionConfig: boolean;
  keywords: string[];
  customJournals: string[];
  matchingKeywords: string[];
  matchingJournals: string[];
  normalizedAt: string | null;
  normalizationError: string | null;
};

type ProfileSubscriptionRow = {
  id?: string;
  contact_email?: string | null;
  is_active: boolean | null;
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
  subscription_normalized_keywords?: string[] | null;
  subscription_normalized_journals?: string[] | null;
  subscription_normalized_at?: string | null;
  subscription_normalization_error?: string | null;
};

const LEGACY_SUBSCRIPTION_SELECT = "is_active,subscription_keywords,custom_journals";
const NORMALIZED_SUBSCRIPTION_SELECT =
  "is_active,subscription_keywords,custom_journals,subscription_normalized_keywords,subscription_normalized_journals,subscription_normalized_at,subscription_normalization_error";
const NORMALIZATION_BACKFILL_SELECT =
  "id,contact_email,is_active,subscription_keywords,custom_journals,subscription_normalization_model";

export function normalizeStringList(input: unknown) {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value) set.add(value);
  }
  return Array.from(set);
}

export async function findProfileIdByContactEmail(
  client: SupabaseDbClient,
  email: string,
) {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("contact_email", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to resolve profile by email: ${error.message}`);
  }
  return data?.id ?? null;
}

export async function getProfileContactEmail(
  client: SupabaseDbClient,
  userId: string,
) {
  const { data, error } = await client
    .from("profiles")
    .select("contact_email")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Profile query failed: ${error.message}`);
  }

  return typeof data?.contact_email === "string" ? data.contact_email : null;
}

export async function getProfileSubscriptionStatus(
  client: SupabaseDbClient,
  userId: string,
): Promise<ProfileSubscriptionStatus> {
  const normalizedQuery = await client
    .from("profiles")
    .select(NORMALIZED_SUBSCRIPTION_SELECT)
    .eq("id", userId)
    .maybeSingle();

  let row: ProfileSubscriptionRow | null = null;
  if (normalizedQuery.error && isMissingColumnError(normalizedQuery.error)) {
    const legacyQuery = await client
      .from("profiles")
      .select(LEGACY_SUBSCRIPTION_SELECT)
      .eq("id", userId)
      .maybeSingle();
    if (legacyQuery.error) {
      throw new Error(`Failed to load profile subscription status: ${legacyQuery.error.message}`);
    }
    row = legacyQuery.data as ProfileSubscriptionRow | null;
  } else {
    if (normalizedQuery.error) {
      throw new Error(`Failed to load profile subscription status: ${normalizedQuery.error.message}`);
    }
    row = normalizedQuery.data as ProfileSubscriptionRow | null;
  }

  const keywords = normalizeStringList(row?.subscription_keywords);
  const customJournals = normalizeStringList(row?.custom_journals);
  const normalizedKeywords = normalizeStringList(row?.subscription_normalized_keywords);
  const normalizedJournals = normalizeStringList(row?.subscription_normalized_journals);
  const subscriptionEnabled = row?.is_active !== false;

  return {
    subscriptionEnabled,
    hasSubscriptionConfig:
      subscriptionEnabled && Boolean(keywords.length || customJournals.length),
    keywords,
    customJournals,
    matchingKeywords: normalizedKeywords.length ? normalizedKeywords : keywords,
    matchingJournals: normalizedJournals.length ? normalizedJournals : customJournals,
    normalizedAt: row?.subscription_normalized_at ?? null,
    normalizationError: row?.subscription_normalization_error ?? null,
  };
}

export async function getUserSubscription(
  client: SupabaseDbClient,
  userId: string,
): Promise<UserSubscription> {
  const status = await getProfileSubscriptionStatus(client, userId);
  return {
    subscription_enabled: status.subscriptionEnabled,
    custom_journals: status.customJournals,
    keywords: status.keywords,
    normalized_custom_journals: status.matchingJournals,
    normalized_keywords: status.matchingKeywords,
    preference_normalized_at: status.normalizedAt,
    preference_normalization_error: status.normalizationError,
  };
}

export async function saveUserSubscription(
  client: SupabaseDbClient,
  userId: string,
  input: UserSubscription,
  normalized?: NormalizedSubscriptionPreferences,
): Promise<UserSubscriptionSaveResponse> {
  const customJournals = normalizeStringList(input.custom_journals);
  const keywords = normalizeStringList(input.keywords);
  const subscriptionEnabled = input.subscription_enabled !== false;
  const normalizedKeywords = normalizeStringList(normalized?.keywords);
  const normalizedJournals = normalizeStringList(normalized?.journals);
  const normalizedAt = normalized ? new Date().toISOString() : null;

  const basePayload = {
    id: userId,
    is_active: subscriptionEnabled,
    subscription_keywords: keywords,
    custom_journals: customJournals,
    updated_at: new Date().toISOString(),
  };

  const extendedPayload = normalized
    ? {
        ...basePayload,
        subscription_normalized_keywords: normalizedKeywords,
        subscription_normalized_journals: normalizedJournals,
        subscription_normalized_terms: normalized.normalizedTerms,
        subscription_normalized_at: normalizedAt,
        subscription_normalization_model: normalized.model,
        subscription_normalization_error: normalized.error,
      }
    : basePayload;

  let { error } = await client
    .from("profiles")
    .upsert(extendedPayload, { onConflict: "id" });

  if (error && normalized && isMissingColumnError(error)) {
    const fallback = await client
      .from("profiles")
      .upsert(basePayload, { onConflict: "id" });
    error = fallback.error;
  }

  if (error) {
    throw new Error(`Failed to save user subscription: ${error.message}`);
  }

  return {
    ok: true,
    subscription_enabled: subscriptionEnabled,
    custom_journals: customJournals,
    keywords,
    normalized_custom_journals: normalizedJournals.length ? normalizedJournals : customJournals,
    normalized_keywords: normalizedKeywords.length ? normalizedKeywords : keywords,
    preference_normalized_at: normalizedAt,
    preference_normalization_error: normalized?.error ?? null,
    ai_normalized: Boolean(normalized && !normalized.error && normalized.model),
  };
}

export async function listProfilesPendingPreferenceNormalization(
  client: SupabaseDbClient,
  limit: number,
) {
  const { data, error } = await client
    .from("profiles")
    .select(NORMALIZATION_BACKFILL_SELECT)
    .or("is_active.is.null,is_active.eq.true")
    .eq("subscription_normalization_model", "raw_backfill")
    .limit(limit);

  if (error) {
    if (isMissingColumnError(error)) return [];
    throw new Error(`Failed to load profiles pending normalization: ${error.message}`);
  }

  return (data ?? []) as ProfileSubscriptionRow[];
}

export async function updateProfilePreferenceNormalization(
  client: SupabaseDbClient,
  userId: string,
  normalized: NormalizedSubscriptionPreferences,
) {
  const { error } = await client
    .from("profiles")
    .update({
      subscription_normalized_keywords: normalizeStringList(normalized.keywords),
      subscription_normalized_journals: normalizeStringList(normalized.journals),
      subscription_normalized_terms: normalized.normalizedTerms,
      subscription_normalized_at: new Date().toISOString(),
      subscription_normalization_model: normalized.model,
      subscription_normalization_error: normalized.error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to update normalized preferences: ${error.message}`);
  }
}
