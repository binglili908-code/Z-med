import { NextResponse } from "next/server";

import { encryptText } from "@/lib/crypto-util";
import { isByokProvider } from "@/lib/byok-config";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceSupabaseClient();
  const { data: profile, error } = await service
    .from("profiles")
    .select("byok_provider,byok_api_key_encrypted,byok_model,ai_digest_enabled")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const masked =
    typeof profile?.byok_api_key_encrypted === "string" && profile.byok_api_key_encrypted
      ? "••••" + profile.byok_api_key_encrypted.slice(-4)
      : null;
  return NextResponse.json({
    provider: profile?.byok_provider ?? null,
    model: profile?.byok_model ?? null,
    apiKeyMasked: masked,
    ai_digest_enabled: profile?.ai_digest_enabled ?? true,
  });
}

export async function PUT(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    provider?: string | null;
    apiKey?: string | null;
    model?: string | null;
    ai_digest_enabled?: boolean;
    clearKey?: boolean;
  };
  try {
    body = (await req.json()) as any;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = body.provider?.trim() || null;
  if (provider && !isByokProvider(provider)) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }

  const service = createServiceSupabaseClient();
  const update: Record<string, any> = {
    id: user.id,
    byok_provider: provider,
    byok_model: body.model?.trim() || null,
    ai_digest_enabled: typeof body.ai_digest_enabled === "boolean" ? body.ai_digest_enabled : true,
    updated_at: new Date().toISOString(),
  };
  if (body.clearKey) {
    update.byok_api_key_encrypted = null;
  } else if (body.apiKey && body.apiKey.trim()) {
    try {
      update.byok_api_key_encrypted = encryptText(body.apiKey.trim());
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Encrypt failed" }, { status: 500 });
    }
  }

  const { error } = await service.from("profiles").upsert(update, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
