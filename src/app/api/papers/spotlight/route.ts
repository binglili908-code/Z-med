import { NextResponse } from "next/server";

import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import { buildSpotlightPapers } from "@/lib/spotlight";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";
import { findProfileIdByContactEmail } from "@/server/repositories/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

async function resolveBypassUserId(service: ReturnType<typeof createServiceSupabaseClient>) {
  const direct = getDevBypassUserId();
  if (direct) return direct;
  const seedEmail = getDevBypassSeedEmail();
  if (!seedEmail) return null;
  return findProfileIdByContactEmail(service, seedEmail);
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  const service = createServiceSupabaseClient();

  let userId: string | null = null;
  if (token) {
    const userClient = createUserSupabaseClient(token);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    userId = user?.id ?? null;
  }
  if (!userId && isDevBypassAuthEnabled()) {
    userId = await resolveBypassUserId(service);
  }

  try {
    const { items, hasProfileConfig, strictMatchFallback, strictMatchMessage } =
      await buildSpotlightPapers({ userId, service });
    return NextResponse.json({
      papers: items,
      total: items.length,
      requiresLogin: !userId && !isDevBypassAuthEnabled(),
      personalized: hasProfileConfig,
      hasSubscription: hasProfileConfig,
      exactMatchTotal: strictMatchFallback ? 0 : items.length,
      strictMatchFallback,
      strictMatchMessage,
      fallbackType: strictMatchFallback ? "topic" : null,
      devBypassAuth: isDevBypassAuthEnabled(),
      devBypassUserId: isDevBypassAuthEnabled() ? userId : null,
      devBypassSeedEmail: isDevBypassAuthEnabled() ? getDevBypassSeedEmail() : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build spotlight" },
      { status: 500 },
    );
  }
}
