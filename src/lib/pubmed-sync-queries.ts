import {
  AI_TERMS,
  MED_TERMS,
  dedupeTerms,
  normalizeToken,
} from "@/lib/pubmed-sync-rules";
import type { MedicalQueryPlan } from "@/lib/medical-query-plan";
import {
  expandJournalTerms,
  expandSubscriptionTerms,
} from "@/lib/subscription-matching";

type ProfileKeywordRow = {
  subscription_keywords?: string[] | null;
  subscription_mesh_terms?: string[] | null;
  custom_journals?: string[] | null;
  subscription_normalized_keywords?: string[] | null;
  subscription_normalized_journals?: string[] | null;
};

function hasLatinOrDigit(input: string) {
  return /[a-z0-9]/i.test(input);
}

function compactPubmedTerm(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanPubmedTerm(input: string) {
  const value = input
    .normalize("NFKC")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/"/g, " ")
    .replace(/[\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value || value.length > 120 || !hasLatinOrDigit(value)) return null;
  return value;
}

export function toPubmedSearchTerms(values: Array<string | null | undefined>, maxItems = 40) {
  const cleaned = values
    .map((value) => (typeof value === "string" ? cleanPubmedTerm(value) : null))
    .filter((value): value is string => Boolean(value));

  const phraseCompactKeys = new Set(
    cleaned.filter((value) => /\s/.test(value)).map((value) => compactPubmedTerm(value)),
  );
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of cleaned) {
    const compact = compactPubmedTerm(value);
    const isCompactMirror =
      !/\s/.test(value) && value.length > 10 && phraseCompactKeys.has(compact);
    if (isCompactMirror) continue;

    const key = compact || value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }

  return out;
}

function preferredTerms(
  row: ProfileKeywordRow,
  normalizedKey: keyof ProfileKeywordRow,
  rawKey: keyof ProfileKeywordRow,
) {
  const normalized = Array.isArray(row[normalizedKey]) ? (row[normalizedKey] as string[]) : [];
  if (normalized.length) return normalized;
  return Array.isArray(row[rawKey]) ? (row[rawKey] as string[]) : [];
}

export function expandKeywordSeedsForSync(values: string[] | null | undefined) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const rawValue = normalizeKeywordSeed(raw);
    if (rawValue && !seen.has(rawValue)) {
      seen.add(rawValue);
      out.push(rawValue);
    }

    for (const keyword of toPubmedSearchTerms(expandSubscriptionTerms([raw]), 20)) {
      const value = normalizeKeywordSeed(keyword);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export function toKeywordList(rows: ProfileKeywordRow[]) {
  const set = new Set<string>();
  for (const row of rows) {
    const keywords = preferredTerms(
      row,
      "subscription_normalized_keywords",
      "subscription_keywords",
    );
    for (const k of toPubmedSearchTerms(expandSubscriptionTerms(keywords), 120)) {
      const v = normalizeToken(k);
      if (v) set.add(v);
    }
    for (const m of toPubmedSearchTerms(row.subscription_mesh_terms ?? [], 40)) {
      const v = normalizeToken(m);
      if (v) set.add(v);
    }
  }
  return Array.from(set);
}

function normalizeKeywordSeed(input: string) {
  const value = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!value || value.length > 120) return "";
  return normalizeToken(value);
}

export function toKeywordSyncSeedList(rows: ProfileKeywordRow[]) {
  const set = new Set<string>();
  for (const row of rows) {
    const normalizedKeywords = Array.isArray(row.subscription_normalized_keywords)
      ? row.subscription_normalized_keywords
      : [];

    if (normalizedKeywords.length) {
      for (const keyword of toPubmedSearchTerms(
        expandSubscriptionTerms(normalizedKeywords),
        120,
      )) {
        const value = normalizeKeywordSeed(keyword);
        if (value) set.add(value);
      }
    } else {
      for (const keyword of expandKeywordSeedsForSync(row.subscription_keywords)) {
        const value = normalizeKeywordSeed(keyword);
        if (value) set.add(value);
      }
    }

    for (const meshTerm of toPubmedSearchTerms(row.subscription_mesh_terms ?? [], 40)) {
      const value = normalizeKeywordSeed(meshTerm);
      if (value) set.add(value);
    }
  }

  return Array.from(set);
}

export function toJournalList(rows: ProfileKeywordRow[]) {
  const set = new Set<string>();
  for (const row of rows) {
    const journals = preferredTerms(
      row,
      "subscription_normalized_journals",
      "custom_journals",
    );
    for (const journal of toPubmedSearchTerms(expandJournalTerms(journals), 120)) {
      const v = normalizeToken(journal);
      if (v) set.add(v);
    }
  }
  return Array.from(set);
}

function quotePubmedTerm(term: string) {
  return `"${term.replace(/"/g, "")}"`;
}

function titleAbstractClause(terms: string[]) {
  return terms.map((term) => `${quotePubmedTerm(term)}[tiab]`).join(" OR ");
}

function meshClause(terms: string[]) {
  return terms
    .filter((term) => term.length > 3 && /\s/.test(term))
    .map((term) => `${quotePubmedTerm(term)}[mh]`)
    .join(" OR ");
}

function journalClause(terms: string[]) {
  return terms
    .map((term) => {
      const quoted = quotePubmedTerm(term);
      return `(${quoted}[jour] OR ${quoted}[ta])`;
    })
    .join(" OR ");
}

export function buildQueryFromKeywords(keywords: string[]) {
  const aiTerms = dedupeTerms(AI_TERMS);
  const medTerms = toPubmedSearchTerms(dedupeTerms([...MED_TERMS, ...keywords]), 80);
  const aiJoined = aiTerms
    .map((k) => `${quotePubmedTerm(k)}[Title/Abstract]`)
    .join(" OR ");
  const medTitleAbstract = titleAbstractClause(medTerms);
  const medMesh = meshClause(medTerms);
  const medJoined = [medTitleAbstract, medMesh].filter(Boolean).join(" OR ");
  return `((${aiJoined}) AND (${medJoined})) AND ("last 7 days"[EDat])`;
}

export function buildTopJournalQuery(journalTerms: string[]) {
  const topJournalTerms = toPubmedSearchTerms(dedupeTerms(journalTerms), 40);
  if (!topJournalTerms.length) return null;
  const journalJoined = journalClause(topJournalTerms);
  const aiJoined = dedupeTerms(AI_TERMS)
    .map((k) => `${quotePubmedTerm(k)}[Title/Abstract]`)
    .join(" OR ");
  return `((${journalJoined}) AND (${aiJoined})) AND ("last 30 days"[EDat])`;
}

export function buildTopJournalBackfillQuery(
  journalTerms: string[],
  fromDate: string,
  toDate: string,
) {
  const topJournalTerms = toPubmedSearchTerms(dedupeTerms(journalTerms), 40);
  if (!topJournalTerms.length) return null;
  const journalJoined = journalClause(topJournalTerms);
  const aiJoined = dedupeTerms(AI_TERMS)
    .map((k) => `${quotePubmedTerm(k)}[Title/Abstract]`)
    .join(" OR ");
  return `((${journalJoined}) AND (${aiJoined})) AND ("${fromDate}"[Date - Publication] : "${toDate}"[Date - Publication])`;
}

export function buildRecentJournalQuery(journalName: string) {
  const terms = toPubmedSearchTerms([journalName], 1);
  if (!terms.length) return null;
  return `(${journalClause(terms)}) AND ("last 30 days"[EDat])`;
}

export function buildUserPreferenceJournalQueries(journalTerms: string[], daysBack = 30) {
  const terms = toPubmedSearchTerms(journalTerms, 80);
  const queries: string[] = [];
  for (let index = 0; index < terms.length; index += 12) {
    const chunk = terms.slice(index, index + 12);
    if (!chunk.length) continue;
    queries.push(`(${journalClause(chunk)}) AND ("last ${daysBack} days"[EDat])`);
  }
  return queries;
}

export function buildUserPreferenceKeywordQueries(keywords: string[], daysBack = 30) {
  const terms = toPubmedSearchTerms(keywords, 80);
  const queries: string[] = [];
  const aiJoined = dedupeTerms(AI_TERMS)
    .map((term) => `${quotePubmedTerm(term)}[Title/Abstract]`)
    .join(" OR ");

  for (let index = 0; index < terms.length; index += 10) {
    const chunk = terms.slice(index, index + 10);
    if (!chunk.length) continue;
    const topicJoined = [titleAbstractClause(chunk), meshClause(chunk)]
      .filter(Boolean)
      .join(" OR ");
    queries.push(
      `((${aiJoined}) AND (${topicJoined})) AND ("last ${daysBack} days"[EDat]) AND hasabstract[text]`,
    );
  }
  return queries;
}

function aiTitleAbstractClause() {
  return dedupeTerms(AI_TERMS)
    .map((term) => `${quotePubmedTerm(term)}[Title/Abstract]`)
    .join(" OR ");
}

function hasRequiredMethodGroup(plan: MedicalQueryPlan, groupNames: string[]) {
  return groupNames.some((name) => {
    const group = plan.groups.find((item) => item.name === name);
    return group?.role === "method";
  });
}

function dedupePubmedQueries(queries: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const value = query.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function buildPlannerKeywordPubmedQueries(
  plan: MedicalQueryPlan,
  daysBack: number,
) {
  if (plan.warnings.some((warning) => warning.startsWith("degraded:"))) return [];

  const queries: string[] = [];
  for (const intent of plan.intents) {
    if (!intent.pubmedQuery.trim()) continue;
    const needsAiConstraint = !hasRequiredMethodGroup(plan, intent.mustMatchGroupNames);
    const topicQuery = needsAiConstraint
      ? `((${aiTitleAbstractClause()}) AND (${intent.pubmedQuery}))`
      : `(${intent.pubmedQuery})`;
    queries.push(
      `${topicQuery} AND ("last ${daysBack} days"[EDat]) AND hasabstract[text]`,
    );
  }

  return dedupePubmedQueries(queries).slice(0, 3);
}

export function formatPubmedDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function buildJournalWindowQuery(
  journalName: string,
  fromDate: string,
  toDate: string,
) {
  const terms = toPubmedSearchTerms([journalName], 1);
  if (!terms.length) return null;
  return `(${journalClause(terms)}) AND (${fromDate}:${toDate}[dp])`;
}

export function monthRangeByOffset(monthOffset: number) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  start.setUTCMonth(start.getUTCMonth() - monthOffset);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const fmt = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
  };
  return { fromDate: fmt(start), toDate: fmt(end) };
}
