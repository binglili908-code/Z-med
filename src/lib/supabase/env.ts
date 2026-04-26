function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function requiredAny(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing required env: ${names.join(" or ")}`);
}

export function getSupabaseUrl() {
  return required("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey() {
  return requiredAny([
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]);
}

export function getSupabaseServiceRoleKey() {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

export function isDevBypassAuthEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DEV_BYPASS_AUTH === "true";
}

export function getDevBypassUserId() {
  const v = process.env.DEV_BYPASS_USER_ID?.trim();
  return v || null;
}

export function getDevBypassSeedEmail() {
  const v = process.env.DEV_BYPASS_SEED_EMAIL?.trim();
  return v || null;
}
