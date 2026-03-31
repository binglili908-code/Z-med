import { createClient } from "@supabase/supabase-js";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export function createUserSupabaseClient(accessToken?: string) {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
