import { NextResponse } from "next/server";

import { encryptText } from "@/lib/crypto-util";
import { isByokProvider } from "@/lib/byok-config";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";
import {
  getByokSettings,
  saveByokSettings,
} from "@/server/repositories/byok-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AiSettingsRequestBody = {
  provider?: string | null;
  apiKey?: string | null;
  model?: string | null;
  ai_digest_enabled?: boolean;
  clearKey?: boolean;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  let profile;
  try {
    profile = await getByokSettings(service, user.id);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }

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

  let body: AiSettingsRequestBody;
  try {
    body = (await req.json()) as AiSettingsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = body.provider?.trim() || null;
  if (provider && !isByokProvider(provider)) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }

  const service = createServiceSupabaseClient();
  let encryptedApiKey: string | null | undefined;
  let shouldUpdateApiKey = false;
  if (body.clearKey) {
    encryptedApiKey = null;
    shouldUpdateApiKey = true;
  } else if (body.apiKey && body.apiKey.trim()) {
    try {
      encryptedApiKey = encryptText(body.apiKey.trim());
      shouldUpdateApiKey = true;
    } catch (error) {
      return NextResponse.json(
        { error: getErrorMessage(error) || "Encrypt failed" },
        { status: 500 },
      );
    }
  }

  try {
    await saveByokSettings(service, user.id, {
      provider,
      model: body.model?.trim() || null,
      aiDigestEnabled: typeof body.ai_digest_enabled === "boolean" ? body.ai_digest_enabled : true,
      encryptedApiKey,
      shouldUpdateApiKey,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
