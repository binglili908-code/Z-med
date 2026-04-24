import { Resend } from "resend";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type CandidatePaper = {
  id: string;
  title: string;
  title_zh?: string | null;
  abstract?: string | null;
  abstract_zh?: string | null;
  ai_analysis?: Record<string, unknown> | null;
  pubmed_url: string | null;
  quality_score: number | null;
  quality_tier: string | null;
  publication_date: string | null;
  journal: string | null;
  keywords: string[] | null;
  mesh_terms: string[] | null;
};

type ProfileRow = {
  id: string;
  contact_email: string | null;
  is_active: boolean | null;
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
};

type WeeklyDeliveryRow = {
  paper_id: string;
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
        <div><a href="${p.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/"}" target="_blank" rel="noreferrer">${p.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/"}</a></div>
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

function normalizeList(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim().toLowerCase();
    if (value) set.add(value);
  }
  return Array.from(set);
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchJournal(paper: CandidatePaper, journalTerms: string[]) {
  if (!journalTerms.length) return true;
  const journal = (paper.journal ?? "").trim().toLowerCase();
  if (!journal) return false;
  return journalTerms.some((term) => journal === term || journal.includes(term) || term.includes(journal));
}

function matchKeyword(paper: CandidatePaper, keywords: string[]) {
  if (!keywords.length) return true;
  const text = [
    paper.title ?? "",
    paper.title_zh ?? "",
    paper.abstract ?? "",
    paper.abstract_zh ?? "",
    paper.journal ?? "",
    (paper.keywords ?? []).join(" "),
    (paper.mesh_terms ?? []).join(" "),
    paper.ai_analysis ? JSON.stringify(paper.ai_analysis) : "",
  ]
    .join("\n")
    .toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function sortCandidates(candidates: CandidatePaper[]) {
  return [...candidates].sort((a, b) => {
    const scoreDiff = Number(b.quality_score ?? 0) - Number(a.quality_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.publication_date ?? "").localeCompare(String(a.publication_date ?? ""));
  });
}

function diversifyCandidates(candidates: CandidatePaper[], maxCount: number) {
  const selected: CandidatePaper[] = [];
  const usedTitle = new Set<string>();
  const journalCount = new Map<string, number>();

  for (const p of candidates) {
    const titleKey = normalizeTitle(p.title);
    if (usedTitle.has(titleKey)) continue;
    const journalKey = (p.journal ?? "general").trim().toLowerCase() || "general";
    if ((journalCount.get(journalKey) ?? 0) >= 1) continue;
    selected.push(p);
    usedTitle.add(titleKey);
    journalCount.set(journalKey, (journalCount.get(journalKey) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  for (const p of candidates) {
    const titleKey = normalizeTitle(p.title);
    if (usedTitle.has(titleKey)) continue;
    const journalKey = (p.journal ?? "general").trim().toLowerCase() || "general";
    if ((journalCount.get(journalKey) ?? 0) >= 2) continue;
    selected.push(p);
    usedTitle.add(titleKey);
    journalCount.set(journalKey, (journalCount.get(journalKey) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  return selected;
}

function selectPersonalizedPool(candidates: CandidatePaper[], profile: ProfileRow) {
  const keywords = normalizeList(profile.subscription_keywords);
  const journals = normalizeList(profile.custom_journals);
  const hasKeywords = keywords.length > 0;
  const hasJournals = journals.length > 0;

  const filtered = candidates.filter((paper) => {
    if (hasJournals && !matchJournal(paper, journals)) return false;
    if (hasKeywords && !matchKeyword(paper, keywords)) return false;
    return true;
  });

  if (!filtered.length && (hasKeywords || hasJournals)) {
    return [];
  }

  return sortCandidates(filtered.length ? filtered : candidates);
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
    .select(
      "id,title,title_zh,abstract,abstract_zh,ai_analysis,pubmed_url,quality_score,quality_tier,publication_date,journal,keywords,mesh_terms",
    )
    .eq("is_ai_med", true)
    .gte("publication_date", summaryStartStr)
    .lte("publication_date", summaryEndStr)
    .order("quality_score", { ascending: false })
    .order("ai_med_score", { ascending: false })
    .order("publication_date", { ascending: false })
    .limit(200);
  if (paperErr) throw new Error(`Load weekly papers failed: ${paperErr.message}`);

  const candidatesAll = (papers ?? []) as CandidatePaper[];
  const candidatePool = sortCandidates(
    candidatesAll.filter(
    (p) => (p.quality_tier ?? "").toLowerCase() === "top" || (p.quality_score ?? 0) >= 0.72,
    ),
  );
  const selected = diversifyCandidates(candidatePool, 5);

  const issueMeta = {
    fromDate: summaryStartStr,
    toDate: summaryEndStr,
    candidateCount: candidatePool.length,
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
    .select("id,contact_email,is_active,subscription_keywords,custom_journals")
    .eq("is_active", true)
    .not("contact_email", "is", null);
  if (profileErr) throw new Error(`Load profiles failed: ${profileErr.message}`);

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM_EMAIL;
  if (!resendApiKey || !resendFrom) {
    throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL");
  }
  const resend = new Resend(resendApiKey);

  let sentCount = 0;
  let skippedRepeatedUsers = 0;
  let skippedNoMatchUsers = 0;
  for (const p of (profiles ?? []) as ProfileRow[]) {
    const to = String(p.contact_email || "").trim();
    if (!to) continue;
    const { data: alreadySentInIssue, error: issueDeliveryErr } = await supabase
      .from("user_weekly_push_deliveries")
      .select("paper_id")
      .eq("issue_id", issueRow.id)
      .eq("user_id", p.id)
      .limit(1);
    if (issueDeliveryErr) {
      throw new Error(`Load weekly delivery status failed: ${issueDeliveryErr.message}`);
    }
    if ((alreadySentInIssue ?? []).length > 0) {
      skippedRepeatedUsers += 1;
      continue;
    }

    const personalizedCandidatesRaw = selectPersonalizedPool(candidatePool, p);
    if (!personalizedCandidatesRaw.length) {
      skippedNoMatchUsers += 1;
      continue;
    }

    const personalizedCandidateIds = personalizedCandidatesRaw.map((x) => x.id);
    const { data: deliveredRows, error: deliveredErr } = personalizedCandidateIds.length
      ? await supabase
          .from("user_weekly_push_deliveries")
          .select("paper_id")
          .eq("user_id", p.id)
          .in("paper_id", personalizedCandidateIds)
      : { data: [] as WeeklyDeliveryRow[], error: null };
    if (deliveredErr) {
      throw new Error(`Load user delivery history failed: ${deliveredErr.message}`);
    }
    const deliveredSet = new Set((deliveredRows ?? []).map((row) => row.paper_id));
    const personalizedCandidates = personalizedCandidatesRaw.filter((paper) => !deliveredSet.has(paper.id));

    const personalized = diversifyCandidates(personalizedCandidates, 5);
    if (!personalized.length) continue;
    const html = buildDigestHtml(personalized);
    const { error } = await resend.emails.send({
      from: resendFrom,
      to,
      subject: `每周 AI+医学精选（${summaryStartStr} ~ ${summaryEndStr}）`,
      html,
    });
    if (!error) {
      const deliveryRows = personalized.map((paper) => ({
        issue_id: issueRow.id,
        user_id: p.id,
        paper_id: paper.id,
        issue_week_start: summaryStartStr,
        delivered_at: new Date().toISOString(),
      }));
      const { error: insertDeliveryErr } = await supabase
        .from("user_weekly_push_deliveries")
        .insert(deliveryRows);
      if (insertDeliveryErr) {
        throw new Error(`Record weekly delivery failed: ${insertDeliveryErr.message}`);
      }
      sentCount += 1;
    }
  }

  await supabase
    .from("push_issues")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      meta: { ...issueMeta, sentCount, skippedRepeatedUsers, skippedNoMatchUsers },
    })
    .eq("id", issueRow.id);

  return {
    issueId: issueRow.id,
    weekStart: summaryStartStr,
    weekEnd: summaryEndStr,
    selectedCount: selected.length,
    sentCount,
    skippedRepeatedUsers,
    skippedNoMatchUsers,
  };
}
