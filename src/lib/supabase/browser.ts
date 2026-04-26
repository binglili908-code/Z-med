import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(url, publishableKey, {
      auth: {
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
