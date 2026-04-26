import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type ByokSettingsRow = {
  byok_provider: string | null;
  byok_api_key_encrypted: string | null;
  byok_model: string | null;
  ai_digest_enabled: boolean | null;
};

export async function getByokSettings(client: SupabaseDbClient, userId: string) {
  const { data, error } = await client
    .from("profiles")
    .select("byok_provider,byok_api_key_encrypted,byok_model,ai_digest_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return (data as ByokSettingsRow | null) ?? null;
}

export async function saveByokSettings(
  client: SupabaseDbClient,
  userId: string,
  values: {
    provider: string | null;
    model: string | null;
    aiDigestEnabled: boolean;
    encryptedApiKey?: string | null;
    shouldUpdateApiKey: boolean;
  },
) {
  const update: Record<string, unknown> = {
    id: userId,
    byok_provider: values.provider,
    byok_model: values.model,
    ai_digest_enabled: values.aiDigestEnabled,
    updated_at: new Date().toISOString(),
  };
  if (values.shouldUpdateApiKey) {
    update.byok_api_key_encrypted = values.encryptedApiKey ?? null;
  }

  const { error } = await client.from("profiles").upsert(update, { onConflict: "id" });
  if (error) {
    throw new Error(error.message);
  }
}
