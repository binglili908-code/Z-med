import { tryFetchWithRetry } from "@/lib/external-fetch";

type ESummaryAuthor = {
  name?: string;
};

type ESummaryArticleId = {
  idtype?: string;
  value?: string;
};

export type PubmedSummary = {
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

export type OpenAccessInfo = {
  is_open_access: boolean;
  oa_pdf_url: string | null;
};

const PUBMED_TIMEOUT_MS = 15000;
const UNPAYWALL_TIMEOUT_MS = 12000;

function fetchPubmed(url: string, label: string) {
  return tryFetchWithRetry(url, {
    cache: "no-store",
    label,
    retries: 2,
    retryDelayMs: 500,
    timeoutMs: PUBMED_TIMEOUT_MS,
  });
}

function fetchUnpaywall(url: string) {
  return tryFetchWithRetry(url, {
    cache: "no-store",
    label: "Unpaywall lookup",
    retries: 1,
    retryDelayMs: 500,
    timeoutMs: UNPAYWALL_TIMEOUT_MS,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelay(minMs: number, maxMs: number) {
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

export function dedupeIdList(ids: string[]) {
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

function addNcbiEnvParams(params: URLSearchParams) {
  if (process.env.NCBI_API_KEY) params.set("api_key", process.env.NCBI_API_KEY);
  if (process.env.NCBI_TOOL) params.set("tool", process.env.NCBI_TOOL);
  if (process.env.NCBI_EMAIL) params.set("email", process.env.NCBI_EMAIL);
}

export async function pubmedEsearch(term: string, retmax: number) {
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    sort: "date",
    retmax: String(retmax),
    term,
  });
  addNcbiEnvParams(params);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
  const res = await fetchPubmed(url, "PubMed esearch");
  if (!res?.ok) return [];
  const json = (await res.json()) as any;
  const ids = json?.esearchresult?.idlist;
  if (!Array.isArray(ids)) return [];
  return ids.filter((x: unknown): x is string => typeof x === "string");
}

async function pubmedEsearchPaged(args: {
  term: string;
  retmax: number;
  retstart: number;
}): Promise<{ ids: string[]; totalCount: number }> {
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    sort: "date",
    retmax: String(args.retmax),
    retstart: String(args.retstart),
    term: args.term,
  });
  addNcbiEnvParams(params);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
  const res = await fetchPubmed(url, "PubMed paged esearch");
  if (!res?.ok) return { ids: [], totalCount: 0 };
  const json = (await res.json()) as any;
  const result = json?.esearchresult;
  const ids = Array.isArray(result?.idlist)
    ? result.idlist.filter((x: unknown): x is string => typeof x === "string")
    : [];
  const totalCountRaw = Number(result?.count ?? 0);
  const totalCount = Number.isFinite(totalCountRaw) ? totalCountRaw : 0;
  return { ids, totalCount };
}

export async function pubmedEsearchAll(args: {
  term: string;
  pageSize: number;
  maxPages: number;
  maxRecords: number;
}) {
  const collected: string[] = [];
  let retstart = 0;
  let totalCount = 0;
  for (let page = 0; page < args.maxPages; page += 1) {
    if (collected.length >= args.maxRecords) break;
    const remaining = args.maxRecords - collected.length;
    const retmax = Math.min(args.pageSize, remaining);
    if (retmax <= 0) break;
    const pageResult = await pubmedEsearchPaged({
      term: args.term,
      retmax,
      retstart,
    });
    totalCount = Math.max(totalCount, pageResult.totalCount);
    if (!pageResult.ids.length) break;
    collected.push(...pageResult.ids);
    retstart += pageResult.ids.length;
    if (pageResult.ids.length < retmax) break;
    if (retstart >= totalCount) break;
    await randomDelay(180, 280);
  }
  return {
    ids: dedupeIdList(collected).slice(0, args.maxRecords),
    totalCount,
  };
}

export async function pubmedEsummary(ids: string[]) {
  if (!ids.length) return [] as PubmedSummary[];
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    id: ids.join(","),
  });
  addNcbiEnvParams(params);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params.toString()}`;
  const res = await fetchPubmed(url, "PubMed esummary");
  if (!res?.ok) return [] as PubmedSummary[];
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

export async function resolveOpenAccessByDoi(doi?: string): Promise<OpenAccessInfo> {
  if (!doi) return { is_open_access: false, oa_pdf_url: null };
  const email = process.env.UNPAYWALL_EMAIL || process.env.NCBI_EMAIL;
  if (!email) return { is_open_access: false, oa_pdf_url: null };

  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  const res = await fetchUnpaywall(url);
  if (!res?.ok) return { is_open_access: false, oa_pdf_url: null };
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

export function chunk<T>(arr: T[], size: number) {
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
  addNcbiEnvParams(params);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params.toString()}`;
  const res = await fetchPubmed(url, "PubMed efetch abstracts");
  if (!res?.ok) return new Map<string, string>();
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

export async function enrichSummariesWithAbstracts(summaries: PubmedSummary[]) {
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
