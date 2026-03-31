import { Resend } from "resend";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type CandidatePaper = {
  id: string;
  title: string;
  pubmed_url: string;
  quality_score: number | null;
  quality_tier: string | null;
  publication_date: string | null;
  journal: string | null;
  keywords: string[] | null;
  mesh_terms: string[] | null;
};

type PaperTopicRelation = {
  paper_id: string;
  confidence: number | null;
  research_topics: { slug: string } | null;
};

function startOfIsoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function toDateString(d: Date) {
  return d.toISOString().slice(0, 10);
}

function buildDigestHtml(papers: CandidatePaper[]) {
  const list = papers
    .map(
      (p, i) => `
      <li style="margin-bottom:12px;">
        <div><strong>${i + 1}. ${p.title}</strong></div>
        <div style="font-size:12px;color:#666;">${p.journal ?? "PubMed"} · ${p.publication_date ?? "N/A"} · score ${p.quality_score ?? 0}</div>
        <div><a href="${p.pubmed_url}" target="_blank" rel="noreferrer">${p.pubmed_url}</a></div>
      </li>`,
    )
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <h2>本周 AI+医学精选文献</h2>
      <ol>${list}</ol>
    </div>
  `;
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function diversifyCandidates(
  candidates: CandidatePaper[],
  maxCount: number,
  paperTopicMap: Map<string, string[]>,
) {
  const selected: CandidatePaper[] = [];
  const usedTitle = new Set<string>();
  const topicCount = new Map<string, number>();

  for (const p of candidates) {
    const titleKey = normalizeTitle(p.title);
    if (usedTitle.has(titleKey)) continue;
    const topics = paperTopicMap.get(p.id) ?? [];
    const primary = topics[0] ?? "general";
    if ((topicCount.get(primary) ?? 0) >= 1) continue;
    selected.push(p);
    usedTitle.add(titleKey);
    topicCount.set(primary, (topicCount.get(primary) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  for (const p of candidates) {
    const titleKey = normalizeTitle(p.title);
    if (usedTitle.has(titleKey)) continue;
    const topics = paperTopicMap.get(p.id) ?? [];
    const primary = topics[0] ?? "general";
    if ((topicCount.get(primary) ?? 0) >= 2) continue;
    selected.push(p);
    usedTitle.add(titleKey);
    topicCount.set(primary, (topicCount.get(primary) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  return selected;
}

function ensureAtLeastThreeTopics(
  selected: CandidatePaper[],
  candidates: CandidatePaper[],
  paperTopicMap: Map<string, string[]>,
  maxCount: number,
) {
  const topicSet = new Set<string>();
  for (const p of selected) {
    const t = paperTopicMap.get(p.id)?.[0];
    if (t) topicSet.add(t);
  }
  if (topicSet.size >= 3 || selected.length >= maxCount) return selected;
  const used = new Set(selected.map((x) => x.id));
  for (const p of candidates) {
    if (used.has(p.id)) continue;
    const primary = paperTopicMap.get(p.id)?.[0];
    if (!primary || topicSet.has(primary)) continue;
    if (selected.length >= maxCount) break;
    selected.push(p);
    used.add(p.id);
    topicSet.add(primary);
    if (topicSet.size >= 3) break;
  }
  return selected.slice(0, maxCount);
}

export async function runWeeklyPushJob() {
  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const currentWeekStart = startOfIsoWeek(now);
  const summaryStart = new Date(currentWeekStart);
  summaryStart.setUTCDate(summaryStart.getUTCDate() - 7);
  const summaryEnd = new Date(currentWeekStart);
  summaryEnd.setUTCDate(summaryEnd.getUTCDate() - 1);
  const summaryStartStr = toDateString(summaryStart);
  const summaryEndStr = toDateString(summaryEnd);

  const { data: papers, error: paperErr } = await supabase
    .from("papers")
    .select("id,title,pubmed_url,quality_score,quality_tier,publication_date,journal,keywords,mesh_terms")
    .eq("is_ai_med", true)
    .gte("publication_date", summaryStartStr)
    .lte("publication_date", summaryEndStr)
    .order("quality_score", { ascending: false })
    .order("ai_med_score", { ascending: false })
    .order("publication_date", { ascending: false })
    .limit(30);
  if (paperErr) throw new Error(`Load weekly papers failed: ${paperErr.message}`);

  const candidatesAll = (papers ?? []) as CandidatePaper[];
  const paperIds = candidatesAll.map((p) => p.id);
  const { data: relRows, error: relErr } = paperIds.length
    ? await supabase
        .from("paper_research_topics")
        .select("paper_id,confidence,research_topics!inner(slug)")
        .in("paper_id", paperIds)
    : { data: [] as PaperTopicRelation[], error: null };
  if (relErr) throw new Error(`Load paper research topics failed: ${relErr.message}`);

  const paperTopicMap = new Map<string, string[]>();
  for (const row of (relRows ?? []) as unknown as PaperTopicRelation[]) {
    const slug = row.research_topics?.slug;
    if (!slug) continue;
    const curr = paperTopicMap.get(row.paper_id) ?? [];
    curr.push(slug);
    paperTopicMap.set(row.paper_id, curr);
  }

  const candidates = candidatesAll.filter(
    (p) => (p.quality_tier ?? "").toLowerCase() === "top" || (p.quality_score ?? 0) >= 0.72,
  );
  let selected = diversifyCandidates(candidates, 5, paperTopicMap);
  selected = ensureAtLeastThreeTopics(selected, candidates, paperTopicMap, 5);

  const issueMeta = {
    fromDate: summaryStartStr,
    toDate: summaryEndStr,
    selectedCount: selected.length,
  };

  const { data: issueRow, error: issueErr } = await supabase
    .from("push_issues")
    .upsert(
      {
        issue_week_start: summaryStartStr,
        status: "draft",
        generated_at: new Date().toISOString(),
        meta: issueMeta,
      },
      { onConflict: "issue_week_start" },
    )
    .select("id")
    .single();
  if (issueErr || !issueRow) throw new Error(`Upsert push issue failed: ${issueErr?.message}`);

  await supabase.from("push_issue_items").delete().eq("issue_id", issueRow.id);

  if (selected.length) {
    const rows = selected.map((p, idx) => ({
      issue_id: issueRow.id,
      paper_id: p.id,
      rank: idx + 1,
      quality_score: p.quality_score ?? 0,
    }));
    const { error: itemsErr } = await supabase.from("push_issue_items").insert(rows);
    if (itemsErr) throw new Error(`Insert push items failed: ${itemsErr.message}`);
  }

  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id,contact_email,is_active")
    .eq("is_active", true)
    .not("contact_email", "is", null);
  if (profileErr) throw new Error(`Load profiles failed: ${profileErr.message}`);

  const profileIds = (profiles ?? []).map((p) => p.id);
  const { data: subRows, error: subErr } = profileIds.length
    ? await supabase
        .from("user_topic_subscriptions")
        .select("user_id,research_topics!inner(slug)")
        .in("user_id", profileIds)
    : { data: [], error: null };
  if (subErr) throw new Error(`Load user topic subscriptions failed: ${subErr.message}`);

  const userTopicMap = new Map<string, Set<string>>();
  for (const row of (subRows ?? []) as Array<{ user_id: string; research_topics: { slug: string } }>) {
    const s = userTopicMap.get(row.user_id) ?? new Set<string>();
    s.add(row.research_topics.slug);
    userTopicMap.set(row.user_id, s);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM_EMAIL;
  if (!resendApiKey || !resendFrom) {
    throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL");
  }
  const resend = new Resend(resendApiKey);

  let sentCount = 0;
  for (const p of profiles ?? []) {
    const to = String(p.contact_email || "").trim();
    if (!to) continue;
    const subscribed = userTopicMap.get(p.id);
    const personalizedCandidates =
      subscribed && subscribed.size
        ? candidates.filter((paper) => {
            const topicSlugs = paperTopicMap.get(paper.id) ?? [];
            return topicSlugs.some((x) => subscribed.has(x));
          })
        : candidates;
    let personalized = diversifyCandidates(personalizedCandidates, 5, paperTopicMap);
    personalized = ensureAtLeastThreeTopics(personalized, personalizedCandidates, paperTopicMap, 5);
    if (!personalized.length) continue;
    const html = buildDigestHtml(personalized);
    const { error } = await resend.emails.send({
      from: resendFrom,
      to,
      subject: `每周 AI+医学精选（${summaryStartStr} ~ ${summaryEndStr}）`,
      html,
    });
    if (!error) sentCount += 1;
  }

  await supabase
    .from("push_issues")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      meta: { ...issueMeta, sentCount },
    })
    .eq("id", issueRow.id);

  return {
    issueId: issueRow.id,
    weekStart: summaryStartStr,
    weekEnd: summaryEndStr,
    selectedCount: selected.length,
    sentCount,
  };
}
