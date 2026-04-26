import type { createServiceSupabaseClient } from "@/lib/supabase/service";
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
};

type ProfileSubscriptionRow = {
  is_active: boolean | null;
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
};

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
  const { data, error } = await client
    .from("profiles")
    .select("is_active,subscription_keywords,custom_journals")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load profile subscription status: ${error.message}`);
  }

  const row = data as ProfileSubscriptionRow | null;
  const keywords = normalizeStringList(row?.subscription_keywords);
  const customJournals = normalizeStringList(row?.custom_journals);
  const subscriptionEnabled = row?.is_active !== false;

  return {
    subscriptionEnabled,
    hasSubscriptionConfig:
      subscriptionEnabled && Boolean(keywords.length || customJournals.length),
    keywords,
    customJournals,
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
  };
}

export async function saveUserSubscription(
  client: SupabaseDbClient,
  userId: string,
  input: UserSubscription,
): Promise<UserSubscriptionSaveResponse> {
  const customJournals = normalizeStringList(input.custom_journals);
  const keywords = normalizeStringList(input.keywords);
  const subscriptionEnabled = input.subscription_enabled !== false;

  const { error } = await client
    .from("profiles")
    .upsert(
      {
        id: userId,
        is_active: subscriptionEnabled,
        subscription_keywords: keywords,
        custom_journals: customJournals,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (error) {
    throw new Error(`Failed to save user subscription: ${error.message}`);
  }

  return {
    ok: true,
    subscription_enabled: subscriptionEnabled,
    custom_journals: customJournals,
    keywords,
  };
}
