import { NextResponse } from "next/server";

import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserSubscription = {
  journal_ids: string[];
  custom_journals: string[];
  keywords: string[];
  top_journals_only: boolean;
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

function normalizeIdList(input: unknown) {
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
    .select("subscription_keywords, custom_journals, top_journals_only")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const { data: journalRows, error: journalErr } = await userClient
    .from("user_journal_subscriptions")
    .select("journal_quality_id")
    .eq("user_id", user.id);
  if (journalErr) {
    return NextResponse.json({ error: journalErr.message }, { status: 500 });
  }

  const payload: UserSubscription = {
    journal_ids: Array.from(new Set((journalRows ?? []).map((row) => row.journal_quality_id))),
    custom_journals: normalizeStringList(profile?.custom_journals),
    keywords: normalizeStringList(profile?.subscription_keywords),
    top_journals_only: Boolean(profile?.top_journals_only),
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

  const journalIds = normalizeIdList(body.journal_ids);
  const customJournals = normalizeStringList(body.custom_journals);
  const keywords = normalizeStringList(body.keywords);
  const topJournalsOnly = Boolean(body.top_journals_only);

  if (journalIds.length) {
    const { data: resolvedJournals, error: journalErr } = await userClient
      .from("journal_quality")
      .select("id")
      .in("id", journalIds);
    if (journalErr) {
      return NextResponse.json({ error: journalErr.message }, { status: 500 });
    }
    if ((resolvedJournals ?? []).length !== journalIds.length) {
      const valid = new Set((resolvedJournals ?? []).map((row) => row.id));
      const invalid = journalIds.filter((id) => !valid.has(id));
      return NextResponse.json(
        { error: `Invalid journal ids: ${invalid.join(",")}` },
        { status: 400 },
      );
    }
  }

  const { error: profileErr } = await userClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        subscription_keywords: keywords,
        custom_journals: customJournals,
        top_journals_only: topJournalsOnly,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const { error: clearErr } = await userClient
    .from("user_journal_subscriptions")
    .delete()
    .eq("user_id", user.id);
  if (clearErr) {
    return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  if (journalIds.length) {
    const now = new Date().toISOString();
    const rows = journalIds.map((journalId) => ({
      user_id: user.id,
      journal_quality_id: journalId,
      created_at: now,
      updated_at: now,
    }));
    const { error: insertErr } = await userClient.from("user_journal_subscriptions").insert(rows);
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    journal_ids: journalIds,
    custom_journals: customJournals,
    keywords,
    top_journals_only: topJournalsOnly,
  });
}
