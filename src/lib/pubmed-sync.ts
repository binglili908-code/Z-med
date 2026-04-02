import { createServiceSupabaseClient } from "@/lib/supabase/service";

type ProfileKeywordRow = {
  subscription_keywords: string[] | null;
  subscription_mesh_terms: string[] | null;
};

type ESummaryAuthor = {
  name?: string;
};

type ESummaryArticleId = {
  idtype?: string;
  value?: string;
};

type PubmedSummary = {
  pmid: string;
  doi?: string;
  title: string;
  abstract: string | null;
  journal: string | null;
  publication_date: string | null;
  pubmed_url: string;
  authors: string[];
  mesh_terms: string[];
  keywords: string[];
  source_payload: Record<string, unknown>;
};

type OpenAccessInfo = {
  is_open_access: boolean;
  oa_pdf_url: string | null;
};

type JournalQualityRow = {
  journal_name: string;
  aliases: string[] | null;
  tier: string;
  weight: number | null;
  is_active: boolean | null;
};

type JournalQualityMatcher = {
  exactByName: Map<string, JournalQualityRow>;
  byAlias: Map<string, JournalQualityRow>;
};

type TopicRule = {
  slug: string;
  keywords: string[];
};

const AI_TERMS = [
  "ai",
  "artificial intelligence",
  "machine learning",
  "deep learning",
  "large language model",
  "foundation model",
  "neural network",
  "transformer",
  "computer vision",
  "natural language processing",
];

const MED_TERMS = [
  "medicine",
  "clinical",
  "radiology",
  "pathology",
  "oncology",
  "cardiology",
  "neurology",
  "medical imaging",
  "electronic health record",
  "diagnosis",
  "treatment",
  "patient",
  "hospital",
  "fibrillation",
  "atrial",
  "cardiac",
  "heart",
];

const TOPIC_KEYWORD_LIBRARY: Record<string, string[]> = {
  imaging: [
    "medical imaging",
    "radiology",
    "ct",
    "mri",
    "ultrasound",
    "echocardiography",
    "cardiac imaging",
    "x-ray",
    "dicom",
    "segmentation",
  ],
  pathology: ["pathology", "digital pathology", "wsi", "whole slide", "histopathology"],
  llm: ["large language model", "llm", "foundation model", "medical chatbot"],
  nlp: [
    "clinical nlp",
    "electronic health record",
    "ehr",
    "clinical note",
    "summarization",
    "information extraction",
  ],
  bioinformatics: ["bioinformatics", "genomics", "proteomics", "single-cell", "transcriptomics"],
  omics: ["metabolomics", "multi-omics", "multiomics", "rna-seq", "rna seq"],
  drug: [
    "drug discovery",
    "virtual screening",
    "target identification",
    "molecular docking",
    "drug design",
    "alphafold",
  ],
  decision: [
    "clinical decision support",
    "risk prediction",
    "prognosis",
    "mortality",
    "icu",
    "complication",
    "triage",
    "early warning",
  ],
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number) {
  const n = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(n);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function toDateString(pubdate?: string): string | null {
  if (!pubdate) return null;
  const m = pubdate.match(/^(\d{4})(?:\s+([A-Za-z]{3}))?(?:\s+(\d{1,2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthMap: Record<string, number> = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12,
  };
  const month = m[2] ? monthMap[m[2]] ?? 1 : 1;
  const day = m[3] ? Number(m[3]) : 1;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function buildPubmedUrl(pmid: string) {
  return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`;
}

function normalizeToken(input: string) {
  return input.trim().toLowerCase();
}

function dedupeTerms(terms: string[]) {
  return Array.from(new Set(terms.map((t) => normalizeToken(t)).filter(Boolean)));
}

function dedupeIdList(ids: string[]) {
  const out: string[] = [];
  const set = new Set<string>();
  for (const id of ids) {
    if (!set.has(id)) {
      set.add(id);
      out.push(id);
    }
  }
  return out;
}

function normalizeJournalKey(input: string) {
  return input.trim().toLowerCase();
}

function toKeywordList(rows: ProfileKeywordRow[]) {
  const set = new Set<string>();
  for (const row of rows) {
    for (const k of row.subscription_keywords ?? []) {
      const v = normalizeToken(k);
      if (v) set.add(v);
    }
    for (const m of row.subscription_mesh_terms ?? []) {
      const v = normalizeToken(m);
      if (v) set.add(v);
    }
  }
  return Array.from(set);
}

function buildQueryFromKeywords(keywords: string[]) {
  const aiTerms = dedupeTerms(AI_TERMS);
  const medTerms = dedupeTerms([...MED_TERMS, ...keywords]).slice(0, 25);
  const aiJoined = aiTerms
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  const medJoined = medTerms
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  return `((${aiJoined}) AND (${medJoined})) AND ("last 7 days"[PDat])`;
}

function buildTopJournalQuery(journalTerms: string[]) {
  const topJournalTerms = dedupeTerms(journalTerms).slice(0, 40);
  if (!topJournalTerms.length) return null;
  const journalJoined = topJournalTerms
    .map((j) => `"${j.replace(/"/g, "")}"[jour]`)
    .join(" OR ");
  const aiJoined = dedupeTerms(AI_TERMS)
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  return `((${journalJoined}) AND (${aiJoined})) AND ("last 30 days"[PDat])`;
}

function buildTopJournalBackfillQuery(journalTerms: string[], fromDate: string, toDate: string) {
  const topJournalTerms = dedupeTerms(journalTerms).slice(0, 40);
  if (!topJournalTerms.length) return null;
  const journalJoined = topJournalTerms
    .map((j) => `"${j.replace(/"/g, "")}"[jour]`)
    .join(" OR ");
  const aiJoined = dedupeTerms(AI_TERMS)
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  return `((${journalJoined}) AND (${aiJoined})) AND ("${fromDate}"[Date - Publication] : "${toDate}"[Date - Publication])`;
}

function findTermMatches(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const term of terms) {
    const t = normalizeToken(term);
    if (!t) continue;
    if (t.length <= 3) {
      const re = new RegExp(`\\b${escaped(t)}\\b`, "i");
      if (re.test(lower)) matched.add(t);
    } else if (lower.includes(t)) {
      matched.add(t);
    }
  }
  return Array.from(matched);
}

function aiMedSignals(paper: PubmedSummary, userKeywords: string[]) {
  const aiTerms = dedupeTerms(AI_TERMS);
  const medTerms = dedupeTerms([...MED_TERMS, ...userKeywords]);
  const sourceText = `${paper.title} ${(paper.mesh_terms ?? []).join(" ")}`.toLowerCase();
  const aiMatched = findTermMatches(sourceText, aiTerms);
  const medMatched = findTermMatches(sourceText, medTerms);
  const isAiMed = aiMatched.length > 0 && medMatched.length > 0;
  const scoreRaw =
    Math.min(aiMatched.length, 4) * 0.15 + Math.min(medMatched.length, 4) * 0.1;
  const aiMedScore = Number(Math.min(1, scoreRaw).toFixed(4));
  const topicKeywords = dedupeTerms([...aiMatched, ...medMatched]).slice(0, 16);
  return { isAiMed, aiMedScore, topicKeywords };
}

function buildTopicRulesFromSlugs(topicSlugs: string[]) {
  const rules: TopicRule[] = [];
  for (const slug of topicSlugs) {
    const parts = slug.toLowerCase().split(/[-_]/g);
    const terms = new Set<string>();
    for (const p of parts) {
      for (const kw of TOPIC_KEYWORD_LIBRARY[p] ?? []) terms.add(kw);
    }
    if (!terms.size) {
      for (const kw of TOPIC_KEYWORD_LIBRARY.decision) terms.add(kw);
    }
    rules.push({ slug, keywords: Array.from(terms) });
  }
  return rules;
}

function assignResearchTopics(paper: PubmedSummary, topicRules: TopicRule[]) {
  const sourceText = `${paper.title} ${(paper.mesh_terms ?? []).join(" ")} ${paper.journal ?? ""}`.toLowerCase();
  const topics: Array<{ slug: string; confidence: number; matchedTerms: string[] }> = [];

  for (const rule of topicRules) {
    const matchedTerms = findTermMatches(sourceText, rule.keywords);
    if (!matchedTerms.length) continue;
    const confidence = Number(
      Math.min(1, 0.35 + Math.min(0.65, matchedTerms.length * 0.18)).toFixed(4),
    );
    topics.push({
      slug: rule.slug,
      confidence,
      matchedTerms: matchedTerms.slice(0, 8),
    });
  }

  return topics;
}

async function loadJournalQualityMap(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
): Promise<JournalQualityMatcher> {
  const { data, error } = await supabase
    .from("journal_quality")
    .select("journal_name,aliases,tier,weight,is_active")
    .eq("is_active", true);
  if (error || !data) {
    return { exactByName: new Map<string, JournalQualityRow>(), byAlias: new Map<string, JournalQualityRow>() };
  }
  const exactByName = new Map<string, JournalQualityRow>();
  const byAlias = new Map<string, JournalQualityRow>();
  for (const row of data as JournalQualityRow[]) {
    const canonical = normalizeJournalKey(row.journal_name);
    if (canonical) exactByName.set(canonical, row);
    for (const alias of row.aliases ?? []) {
      const normalized = normalizeJournalKey(alias);
      if (normalized) byAlias.set(normalized, row);
    }
  }
  return { exactByName, byAlias };
}

async function loadTopJournalTerms(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const { data, error } = await supabase
    .from("journal_quality")
    .select("journal_name,aliases")
    .eq("is_active", true)
    .eq("tier", "top");
  if (error || !data) return [] as string[];
  const terms: string[] = [];
  for (const row of data as Array<{ journal_name: string; aliases: string[] | null }>) {
    terms.push(row.journal_name);
    for (const a of row.aliases ?? []) terms.push(a);
  }
  return dedupeTerms(terms);
}

function resolveJournalQuality(
  paper: PubmedSummary,
  matcher: JournalQualityMatcher,
) {
  const journal = normalizeJournalKey(paper.journal ?? "");
  if (!journal) return null;
  const exact = matcher.exactByName.get(journal);
  if (exact) return exact;
  return matcher.byAlias.get(journal) ?? null;
}

function qualitySignals(args: {
  aiMedScore: number;
  journalMatched: JournalQualityRow | null;
}) {
  const journalWeight = Number(args.journalMatched?.weight ?? 0.5);
  const qualityScore = Number((args.aiMedScore * journalWeight).toFixed(4));
  const qualityTier = args.journalMatched?.tier ?? "emerging";
  return { qualityScore, qualityTier };
}

async function scoreAndUpsertPapers(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  summaries: PubmedSummary[];
  keywords: string[];
  journalMap: JournalQualityMatcher;
}) {
  const upsertRows: Record<string, unknown>[] = [];
  const { data: topicRefRows, error: topicRefErr } = await args.supabase
    .from("research_topics")
    .select("id,slug")
    .eq("is_active", true);
  if (topicRefErr) {
    throw new Error(`Failed to load research topics: ${topicRefErr.message}`);
  }
  const topicIdMap = new Map<string, string>();
  const topicRules = buildTopicRulesFromSlugs((topicRefRows ?? []).map((r) => r.slug));
  for (const r of topicRefRows ?? []) {
    topicIdMap.set(r.slug, r.id);
  }

  const researchTopicsByPmid = new Map<
    string,
    Array<{ slug: string; confidence: number; matchedTerms: string[] }>
  >();

  for (const paper of args.summaries) {
    const signals = aiMedSignals(paper, args.keywords);
    if (!signals.isAiMed) continue;
    const journalMatched = resolveJournalQuality(paper, args.journalMap);
    const quality = qualitySignals({
      aiMedScore: signals.aiMedScore,
      journalMatched,
    });
    const oa = await resolveOpenAccessByDoi(paper.doi);
    upsertRows.push({
      pmid: paper.pmid,
      doi: paper.doi ?? null,
      title: paper.title,
      abstract: paper.abstract,
      journal: paper.journal,
      publication_date: paper.publication_date,
      pubmed_url: paper.pubmed_url,
      authors: paper.authors,
      mesh_terms: paper.mesh_terms,
      keywords: signals.topicKeywords,
      is_ai_med: true,
      ai_med_score: signals.aiMedScore,
      quality_score: quality.qualityScore,
      quality_tier: quality.qualityTier,
      is_open_access: oa.is_open_access,
      oa_pdf_url: oa.oa_pdf_url,
      source_payload: paper.source_payload,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const assignedTopics = assignResearchTopics(paper, topicRules);
    if (assignedTopics.length) {
      researchTopicsByPmid.set(paper.pmid, assignedTopics);
    }
    await randomDelay(120, 220);
  }

  if (!upsertRows.length) {
    return { upsertRows, aiMedCount: 0 };
  }

  const { error: upsertErr } = await args.supabase
    .from("papers")
    .upsert(upsertRows, { onConflict: "pmid" });
  if (upsertErr) {
    throw new Error(`Failed to upsert papers: ${upsertErr.message}`);
  }

  const pmids = upsertRows.map((r) => String(r.pmid));
  const { data: paperRows, error: paperRowsErr } = await args.supabase
    .from("papers")
    .select("id,pmid")
    .in("pmid", pmids);
  if (paperRowsErr) {
    throw new Error(`Failed to load paper ids: ${paperRowsErr.message}`);
  }

  const relationRows: Array<{
    paper_id: string;
    topic_id: string;
    confidence: number;
    source: string;
    matched_terms: string[];
    updated_at: string;
  }> = [];

  for (const row of paperRows ?? []) {
    const assigned = researchTopicsByPmid.get(row.pmid) ?? [];
    for (const t of assigned) {
      const topicId = topicIdMap.get(t.slug);
      if (!topicId) continue;
      relationRows.push({
        paper_id: row.id,
        topic_id: topicId,
        confidence: t.confidence,
        source: "rule",
        matched_terms: t.matchedTerms,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (relationRows.length) {
    const { error: relationErr } = await args.supabase
      .from("paper_research_topics")
      .upsert(relationRows, { onConflict: "paper_id,topic_id" });
    if (relationErr) {
      throw new Error(`Failed to upsert paper research topics: ${relationErr.message}`);
    }
  }

  return { upsertRows, aiMedCount: upsertRows.length };
}

async function readBackfillMonthOffset(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  try {
    const { data, error } = await supabase
      .from("sync_state")
      .select("value")
      .eq("key", "backfill_6m_month_offset")
      .maybeSingle();
    if (error) return 1;
    const n = Number((data as { value?: string } | null)?.value ?? 1);
    if (!Number.isFinite(n) || n < 1 || n > 6) return 1;
    return n;
  } catch {
    return 1;
  }
}

async function writeBackfillMonthOffset(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  offset: number,
) {
  try {
    await supabase.from("sync_state").upsert(
      {
        key: "backfill_6m_month_offset",
        value: String(offset),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {
    return;
  }
}

function monthRangeByOffset(monthOffset: number) {
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

async function pubmedEsearch(term: string, retmax: number) {
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    sort: "date",
    retmax: String(retmax),
    term,
  });
  if (process.env.NCBI_API_KEY) params.set("api_key", process.env.NCBI_API_KEY);
  if (process.env.NCBI_TOOL) params.set("tool", process.env.NCBI_TOOL);
  if (process.env.NCBI_EMAIL) params.set("email", process.env.NCBI_EMAIL);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as any;
  const ids = json?.esearchresult?.idlist;
  if (!Array.isArray(ids)) return [];
  return ids.filter((x: unknown): x is string => typeof x === "string");
}

async function pubmedEsummary(ids: string[]) {
  if (!ids.length) return [] as PubmedSummary[];
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    id: ids.join(","),
  });
  if (process.env.NCBI_API_KEY) params.set("api_key", process.env.NCBI_API_KEY);
  if (process.env.NCBI_TOOL) params.set("tool", process.env.NCBI_TOOL);
  if (process.env.NCBI_EMAIL) params.set("email", process.env.NCBI_EMAIL);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [] as PubmedSummary[];
  const json = (await res.json()) as any;
  const result = json?.result;
  if (!result || typeof result !== "object") return [] as PubmedSummary[];

  const items: PubmedSummary[] = [];
  for (const id of ids) {
    const item = result[id];
    if (!item || typeof item !== "object") continue;

    const pmid = asString(item.uid) ?? id;
    const title = (asString(item.title) ?? "").trim();
    if (!title) continue;

    const articleIds = (item.articleids ?? []) as ESummaryArticleId[];
    const doi = articleIds.find((x) => x?.idtype === "doi")?.value;

    const authors = Array.isArray(item.authors)
      ? (item.authors as ESummaryAuthor[])
          .map((a) => asString(a?.name))
          .filter((x): x is string => Boolean(x))
      : [];

    const mesh = Array.isArray(item.meshheadinglist)
      ? (item.meshheadinglist as unknown[])
          .map((x) => asString(x))
          .filter((x): x is string => Boolean(x))
      : [];

    const date = toDateString(asString(item.pubdate));
    const journal = asString(item.fulljournalname) ?? asString(item.source) ?? null;

    items.push({
      pmid,
      doi,
      title,
      abstract: null,
      journal,
      publication_date: date,
      pubmed_url: buildPubmedUrl(pmid),
      authors,
      mesh_terms: mesh,
      keywords: [],
      source_payload: item as Record<string, unknown>,
    });
  }
  return items;
}

async function resolveOpenAccessByDoi(doi?: string): Promise<OpenAccessInfo> {
  if (!doi) return { is_open_access: false, oa_pdf_url: null };
  const email = process.env.UNPAYWALL_EMAIL || process.env.NCBI_EMAIL;
  if (!email) return { is_open_access: false, oa_pdf_url: null };

  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { is_open_access: false, oa_pdf_url: null };
  const json = (await res.json()) as any;
  const isOa = Boolean(json?.is_oa);
  const pdf =
    asString(json?.best_oa_location?.url_for_pdf) ??
    asString(json?.best_oa_location?.url) ??
    null;
  return {
    is_open_access: isOa,
    oa_pdf_url: isOa ? pdf : null,
  };
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function decodeXmlEntities(input: string) {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function stripXmlTags(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseAbstractFromArticleXml(articleXml: string) {
  const abstractMatches = Array.from(
    articleXml.matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/gi),
  );
  if (!abstractMatches.length) return null;
  const parts = abstractMatches
    .map((m) => stripXmlTags(decodeXmlEntities(m[1] ?? "")))
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.join("\n");
}

async function pubmedEfetchAbstractMap(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "xml",
    id: ids.join(","),
  });
  if (process.env.NCBI_API_KEY) params.set("api_key", process.env.NCBI_API_KEY);
  if (process.env.NCBI_TOOL) params.set("tool", process.env.NCBI_TOOL);
  if (process.env.NCBI_EMAIL) params.set("email", process.env.NCBI_EMAIL);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return new Map<string, string>();
  const xml = await res.text();
  const map = new Map<string, string>();
  const articleBlocks = Array.from(xml.matchAll(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gi));
  for (const block of articleBlocks) {
    const articleXml = block[0];
    const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/i);
    const pmid = pmidMatch?.[1];
    if (!pmid) continue;
    const abstract = parseAbstractFromArticleXml(articleXml);
    if (abstract) {
      map.set(pmid, abstract);
    }
  }
  return map;
}

async function enrichSummariesWithAbstracts(summaries: PubmedSummary[]) {
  if (!summaries.length) return summaries;
  const byPmid = new Map<string, PubmedSummary>();
  for (const s of summaries) {
    byPmid.set(s.pmid, s);
  }
  const ids = summaries.map((s) => s.pmid);
  const groups = chunk(ids, 20);
  for (const group of groups) {
    const abstractMap = await pubmedEfetchAbstractMap(group);
    for (const [pmid, abstract] of abstractMap.entries()) {
      const curr = byPmid.get(pmid);
      if (curr) curr.abstract = abstract;
    }
    await randomDelay(120, 220);
  }
  return summaries;
}

export async function runPubmedSyncJob() {
  const supabase = createServiceSupabaseClient();
  const journalMap = await loadJournalQualityMap(supabase);
  const topJournalTerms = await loadTopJournalTerms(supabase);

  const { data: profileRows, error: profileErr } = await supabase
    .from("profiles")
    .select("subscription_keywords, subscription_mesh_terms")
    .eq("is_active", true);

  if (profileErr) {
    throw new Error(`Failed to read profiles: ${profileErr.message}`);
  }

  const keywords = toKeywordList((profileRows ?? []) as ProfileKeywordRow[]);
  const broadQuery = buildQueryFromKeywords(keywords);
  const broadIds = await pubmedEsearch(broadQuery, 60);
  const topJournalQuery = buildTopJournalQuery(topJournalTerms);
  const topJournalIds = topJournalQuery ? await pubmedEsearch(topJournalQuery, 120) : [];
  const ids = dedupeIdList([...topJournalIds, ...broadIds]);

  const summaryChunks = chunk(ids, 20);
  const summaries: PubmedSummary[] = [];
  for (const group of summaryChunks) {
    const part = await pubmedEsummary(group);
    summaries.push(...part);
    await randomDelay(180, 320);
  }
  await enrichSummariesWithAbstracts(summaries);

  const { upsertRows, aiMedCount } = await scoreAndUpsertPapers({
    supabase,
    summaries,
    keywords,
    journalMap,
  });

  return {
    keywordCount: keywords.length,
    topJournalTermCount: topJournalTerms.length,
    topJournalFetchedCount: topJournalIds.length,
    fetchedCount: summaries.length,
    aiMedCount,
    upsertedCount: upsertRows.length,
    query: broadQuery,
    topJournalQuery,
  };
}

export async function runPubmedBackfillJob() {
  const supabase = createServiceSupabaseClient();
  const journalMap = await loadJournalQualityMap(supabase);
  const topJournalTerms = await loadTopJournalTerms(supabase);
  const monthOffset = await readBackfillMonthOffset(supabase);
  const { fromDate, toDate } = monthRangeByOffset(monthOffset);

  const query = buildTopJournalBackfillQuery(topJournalTerms, fromDate, toDate);
  if (!query) {
    return {
      monthOffset,
      fromDate,
      toDate,
      fetchedCount: 0,
      aiMedCount: 0,
      upsertedCount: 0,
      query: null,
    };
  }

  const ids = await pubmedEsearch(query, 200);
  const summaryChunks = chunk(ids, 20);
  const summaries: PubmedSummary[] = [];
  for (const group of summaryChunks) {
    const part = await pubmedEsummary(group);
    summaries.push(...part);
    await randomDelay(180, 320);
  }
  await enrichSummariesWithAbstracts(summaries);

  const { upsertRows, aiMedCount } = await scoreAndUpsertPapers({
    supabase,
    summaries,
    keywords: [],
    journalMap,
  });

  const nextOffset = monthOffset >= 6 ? 1 : monthOffset + 1;
  await writeBackfillMonthOffset(supabase, nextOffset);

  return {
    monthOffset,
    nextOffset,
    fromDate,
    toDate,
    fetchedCount: summaries.length,
    aiMedCount,
    upsertedCount: upsertRows.length,
    query,
  };
}
