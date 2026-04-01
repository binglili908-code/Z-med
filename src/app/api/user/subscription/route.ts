import { NextResponse } from "next/server";

import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserSubscription = {
  topic_slugs: string[];
  keywords: string[];
  top_journals_only: boolean;
  min_score?: number;
};

type TopicRow = {
  topic_id: string;
  research_topics: { slug: string } | { slug: string }[] | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

function normalizeKeywordList(input: unknown) {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function normalizeTopicSlugList(input: unknown) {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function toSlug(value: TopicRow["research_topics"]) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0]?.slug ?? null;
  return value.slug ?? null;
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
    .select("subscription_keywords, top_journals_only, subscription_min_score")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const { data: topicRows, error: topicErr } = await userClient
    .from("user_topic_subscriptions")
    .select("topic_id,research_topics(slug)")
    .eq("user_id", user.id);
  if (topicErr) {
    return NextResponse.json({ error: topicErr.message }, { status: 500 });
  }

  const topicSlugs = Array.from(
    new Set(
      ((topicRows ?? []) as TopicRow[])
        .map((row) => toSlug(row.research_topics))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  );

  const payload: UserSubscription = {
    topic_slugs: topicSlugs,
    keywords: normalizeKeywordList(profile?.subscription_keywords),
    top_journals_only: Boolean(profile?.top_journals_only),
    min_score:
      typeof profile?.subscription_min_score === "number"
        ? profile.subscription_min_score
        : Number(profile?.subscription_min_score ?? 0),
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

  const topicSlugs = normalizeTopicSlugList(body.topic_slugs);
  const keywords = normalizeKeywordList(body.keywords);
  const topJournalsOnly = Boolean(body.top_journals_only);
  const minScore = Number.isFinite(body.min_score) ? Number(body.min_score) : 0;

  const { data: topics, error: topicsErr } = await userClient
    .from("research_topics")
    .select("id,slug")
    .in("slug", topicSlugs.length ? topicSlugs : ["__none__"]);
  if (topicsErr) {
    return NextResponse.json({ error: topicsErr.message }, { status: 500 });
  }

  const resolvedTopics = topics ?? [];
  if (topicSlugs.length && resolvedTopics.length !== topicSlugs.length) {
    const found = new Set(resolvedTopics.map((t) => t.slug));
    const invalid = topicSlugs.filter((slug) => !found.has(slug));
    return NextResponse.json(
      { error: `Invalid topic slugs: ${invalid.join(",")}` },
      { status: 400 },
    );
  }

  const { error: profileErr } = await userClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        subscription_keywords: keywords,
        top_journals_only: topJournalsOnly,
        subscription_min_score: minScore,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const { error: clearErr } = await userClient
    .from("user_topic_subscriptions")
    .delete()
    .eq("user_id", user.id);
  if (clearErr) {
    return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  if (resolvedTopics.length) {
    const now = new Date().toISOString();
    const rows = resolvedTopics.map((topic) => ({
      user_id: user.id,
      topic_id: topic.id,
      created_at: now,
      updated_at: now,
    }));
    const { error: insertErr } = await userClient.from("user_topic_subscriptions").insert(rows);
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    topic_slugs: topicSlugs,
    keywords,
    top_journals_only: topJournalsOnly,
    min_score: minScore,
  });
}
