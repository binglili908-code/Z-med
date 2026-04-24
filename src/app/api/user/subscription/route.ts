import { NextResponse } from "next/server";

import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserSubscription = {
  subscription_enabled: boolean;
  custom_journals: string[];
  keywords: string[];
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

function normalizeStringList(input: unknown) {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (v) set.add(v);
  }
  return Array.from(set);
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileErr } = await userClient
    .from("profiles")
    .select("subscription_keywords, custom_journals, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const payload: UserSubscription = {
    subscription_enabled: profile?.is_active !== false,
    custom_journals: normalizeStringList(profile?.custom_journals),
    keywords: normalizeStringList(profile?.subscription_keywords),
  };

  return NextResponse.json(payload);
}

export async function PUT(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: UserSubscription;
  try {
    body = (await req.json()) as UserSubscription;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const customJournals = normalizeStringList(body.custom_journals);
  const keywords = normalizeStringList(body.keywords);
  const subscriptionEnabled = body.subscription_enabled !== false;

  const { error: profileErr } = await userClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        is_active: subscriptionEnabled,
        subscription_keywords: keywords,
        custom_journals: customJournals,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    subscription_enabled: subscriptionEnabled,
    custom_journals: customJournals,
    keywords,
  });
}
