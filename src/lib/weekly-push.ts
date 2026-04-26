import { createResendEmailSender } from "@/lib/resend-email";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  hasWeeklyPushDeliveryForIssue,
  insertWeeklyPushDeliveries,
  listActiveWeeklyPushProfiles,
  listDeliveredWeeklyPushPaperIds,
  listWeeklyPushCandidatePapers,
  markWeeklyPushIssueSent,
  replaceWeeklyPushIssueItems,
  upsertWeeklyPushIssueDraft,
  type WeeklyPushCandidatePaper,
  type WeeklyPushProfileRow,
} from "@/server/repositories/weekly-push";

function startOfIsoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function toDateString(d: Date) {
  return d.toISOString().slice(0, 10);
}

function buildDigestHtml(papers: WeeklyPushCandidatePaper[]) {
  const list = papers
    .map(
      (paper, index) => `
      <li style="margin-bottom:12px;">
        <div><strong>${index + 1}. ${paper.title}</strong></div>
        <div style="font-size:12px;color:#666;">${paper.journal ?? "PubMed"} · ${paper.publication_date ?? "N/A"} · score ${paper.quality_score ?? 0}</div>
        <div><a href="${paper.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/"}" target="_blank" rel="noreferrer">${paper.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/"}</a></div>
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

function matchJournal(paper: WeeklyPushCandidatePaper, journalTerms: string[]) {
  if (!journalTerms.length) return true;
  const journal = (paper.journal ?? "").trim().toLowerCase();
  if (!journal) return false;
  return journalTerms.some((term) => journal === term || journal.includes(term) || term.includes(journal));
}

function matchKeyword(paper: WeeklyPushCandidatePaper, keywords: string[]) {
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

function sortCandidates(candidates: WeeklyPushCandidatePaper[]) {
  return [...candidates].sort((a, b) => {
    const scoreDiff = Number(b.quality_score ?? 0) - Number(a.quality_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.publication_date ?? "").localeCompare(String(a.publication_date ?? ""));
  });
}

function diversifyCandidates(candidates: WeeklyPushCandidatePaper[], maxCount: number) {
  const selected: WeeklyPushCandidatePaper[] = [];
  const usedTitle = new Set<string>();
  const journalCount = new Map<string, number>();

  for (const paper of candidates) {
    const titleKey = normalizeTitle(paper.title);
    if (usedTitle.has(titleKey)) continue;
    const journalKey = (paper.journal ?? "general").trim().toLowerCase() || "general";
    if ((journalCount.get(journalKey) ?? 0) >= 1) continue;
    selected.push(paper);
    usedTitle.add(titleKey);
    journalCount.set(journalKey, (journalCount.get(journalKey) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  for (const paper of candidates) {
    const titleKey = normalizeTitle(paper.title);
    if (usedTitle.has(titleKey)) continue;
    const journalKey = (paper.journal ?? "general").trim().toLowerCase() || "general";
    if ((journalCount.get(journalKey) ?? 0) >= 2) continue;
    selected.push(paper);
    usedTitle.add(titleKey);
    journalCount.set(journalKey, (journalCount.get(journalKey) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  return selected;
}

function selectPersonalizedPool(
  candidates: WeeklyPushCandidatePaper[],
  profile: WeeklyPushProfileRow,
) {
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

  const candidatesAll = await listWeeklyPushCandidatePapers(supabase, {
    summaryStart: summaryStartStr,
    summaryEnd: summaryEndStr,
    limit: 200,
  });
  const candidatePool = sortCandidates(
    candidatesAll.filter(
      (paper) =>
        (paper.quality_tier ?? "").toLowerCase() === "top" ||
        (paper.quality_score ?? 0) >= 0.72,
    ),
  );
  const selected = diversifyCandidates(candidatePool, 5);

  const issueMeta = {
    fromDate: summaryStartStr,
    toDate: summaryEndStr,
    candidateCount: candidatePool.length,
    selectedCount: selected.length,
  };

  const issueId = await upsertWeeklyPushIssueDraft(supabase, {
    issueWeekStart: summaryStartStr,
    meta: issueMeta,
  });
  await replaceWeeklyPushIssueItems(supabase, {
    issueId,
    papers: selected,
  });

  const profiles = await listActiveWeeklyPushProfiles(supabase);

  const sendEmail = createResendEmailSender();

  let sentCount = 0;
  let skippedRepeatedUsers = 0;
  let skippedNoMatchUsers = 0;
  for (const profile of profiles) {
    const to = String(profile.contact_email || "").trim();
    if (!to) continue;
    const alreadySentInIssue = await hasWeeklyPushDeliveryForIssue(supabase, {
      issueId,
      userId: profile.id,
    });
    if (alreadySentInIssue) {
      skippedRepeatedUsers += 1;
      continue;
    }

    const personalizedCandidatesRaw = selectPersonalizedPool(candidatePool, profile);
    if (!personalizedCandidatesRaw.length) {
      skippedNoMatchUsers += 1;
      continue;
    }

    const personalizedCandidateIds = personalizedCandidatesRaw.map((paper) => paper.id);
    const deliveredSet = await listDeliveredWeeklyPushPaperIds(supabase, {
      userId: profile.id,
      paperIds: personalizedCandidateIds,
    });
    const personalizedCandidates = personalizedCandidatesRaw.filter(
      (paper) => !deliveredSet.has(paper.id),
    );

    const personalized = diversifyCandidates(personalizedCandidates, 5);
    if (!personalized.length) continue;
    const html = buildDigestHtml(personalized);
    try {
      await sendEmail({
        to,
        subject: `每周 AI+医学精选（${summaryStartStr} ~ ${summaryEndStr}）`,
        html,
      });
    } catch {
      continue;
    }

    const deliveryRows = personalized.map((paper) => ({
      issue_id: issueId,
      user_id: profile.id,
      paper_id: paper.id,
      issue_week_start: summaryStartStr,
      delivered_at: new Date().toISOString(),
    }));
    await insertWeeklyPushDeliveries(supabase, deliveryRows);
    sentCount += 1;
  }

  await markWeeklyPushIssueSent(supabase, {
    issueId,
    meta: { ...issueMeta, sentCount, skippedRepeatedUsers, skippedNoMatchUsers },
  });

  return {
    issueId,
    weekStart: summaryStartStr,
    weekEnd: summaryEndStr,
    selectedCount: selected.length,
    sentCount,
    skippedRepeatedUsers,
    skippedNoMatchUsers,
  };
}
