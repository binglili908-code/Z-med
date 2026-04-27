import { tryFetchWithRetry } from "@/lib/external-fetch";
import { dedupeTerms } from "@/lib/pubmed-sync-rules";
import { normalizeMatchText } from "@/lib/subscription-matching";

export type PubmedSpellCheckResult = {
  original: string;
  corrected: string;
  hasSuggestion: boolean;
};

export type PubmedMeshRecord = {
  meshId: string;
  name: string;
  entryTerms: string[];
  scopeNote?: string | null;
};

export type PubmedKeywordAssistResult = {
  keywords: string[];
  correctedTerms: Array<{
    original: string;
    corrected: string;
  }>;
  meshRecords: PubmedMeshRecord[];
  errors: string[];
};

type MeshSummaryJson = {
  result?: Record<string, unknown> & {
    uids?: unknown;
  };
};

const PUBMED_ASSIST_TIMEOUT_MS = 9000;
const DEFAULT_MAX_TERMS = 8;
const DEFAULT_MAX_MESH_RECORDS_PER_TERM = 2;
const DEFAULT_MAX_ENTRY_TERMS_PER_RECORD = 8;

function isPubmedAssistEnabled() {
  return process.env.PUBMED_QUERY_ASSIST_ENABLED !== "false";
}

function hasLatinOrDigit(input: string) {
  return /[a-z0-9]/i.test(input);
}

function cleanAssistTerm(input: string) {
  const value = input
    .normalize("NFKC")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/["[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || value.length > 120 || !hasLatinOrDigit(value)) return null;
  return value;
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

function firstXmlTag(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ? decodeXmlEntities(match[1]).trim() : "";
}

function dedupeForMatching(values: string[], maxItems: number) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanAssistTerm(value);
    if (!cleaned) continue;
    const key = normalizeMatchText(cleaned).replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

function addNcbiEnvParams(params: URLSearchParams) {
  if (process.env.NCBI_API_KEY) params.set("api_key", process.env.NCBI_API_KEY);
  if (process.env.NCBI_TOOL) params.set("tool", process.env.NCBI_TOOL);
  if (process.env.NCBI_EMAIL) params.set("email", process.env.NCBI_EMAIL);
}

async function fetchNcbi(url: string, label: string) {
  return tryFetchWithRetry(url, {
    cache: "no-store",
    label,
    retries: 1,
    retryDelayMs: 500,
    timeoutMs: PUBMED_ASSIST_TIMEOUT_MS,
  });
}

export function parsePubmedSpellCheckXml(
  xml: string,
  fallbackQuery: string,
): PubmedSpellCheckResult {
  const original = firstXmlTag(xml, "Query") || fallbackQuery;
  const corrected = firstXmlTag(xml, "CorrectedQuery") || original;
  return {
    original,
    corrected,
    hasSuggestion:
      normalizeMatchText(corrected) !== normalizeMatchText(original) &&
      Boolean(corrected.trim()),
  };
}

export async function pubmedSpellCheck(query: string): Promise<PubmedSpellCheckResult | null> {
  const term = cleanAssistTerm(query);
  if (!term) return null;
  const params = new URLSearchParams({
    db: "pubmed",
    term,
  });
  addNcbiEnvParams(params);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/espell.fcgi?${params.toString()}`;
  const res = await fetchNcbi(url, "PubMed ESpell");
  if (!res?.ok) return null;
  const xml = await res.text();
  return parsePubmedSpellCheckXml(xml, term);
}

function idListFromESearchJson(json: unknown) {
  if (!json || typeof json !== "object") return [] as string[];
  const result = (json as { esearchresult?: { idlist?: unknown } }).esearchresult;
  if (!Array.isArray(result?.idlist)) return [];
  return result.idlist.filter((id): id is string => typeof id === "string");
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

export function parseMeshSummaryJson(json: MeshSummaryJson, ids: string[]) {
  const result = json.result;
  if (!result || typeof result !== "object") return [] as PubmedMeshRecord[];

  const records: PubmedMeshRecord[] = [];
  for (const id of ids) {
    const item = result[id];
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const terms = stringArray(row.ds_meshterms);
    const name = typeof row.ds_name === "string" ? row.ds_name : terms[0];
    if (!name) continue;
    records.push({
      meshId: id,
      name,
      entryTerms: dedupeForMatching(terms.filter((term) => term !== name), 20),
      scopeNote: typeof row.ds_scopenote === "string" ? row.ds_scopenote : null,
    });
  }
  return records;
}

export async function pubmedLookupMesh(
  term: string,
  options: {
    maxResults?: number;
  } = {},
) {
  const cleaned = cleanAssistTerm(term);
  if (!cleaned) return [] as PubmedMeshRecord[];
  const maxResults = Math.max(1, Math.min(5, options.maxResults ?? DEFAULT_MAX_MESH_RECORDS_PER_TERM));
  const searchParams = new URLSearchParams({
    db: "mesh",
    retmode: "json",
    retmax: String(maxResults),
    term: cleaned,
  });
  addNcbiEnvParams(searchParams);

  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams.toString()}`;
  const searchRes = await fetchNcbi(searchUrl, "PubMed MeSH search");
  if (!searchRes?.ok) return [];
  const searchJson = await searchRes.json();
  const ids = idListFromESearchJson(searchJson).slice(0, maxResults);
  if (!ids.length) return [];

  const summaryParams = new URLSearchParams({
    db: "mesh",
    retmode: "json",
    id: ids.join(","),
  });
  addNcbiEnvParams(summaryParams);

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams.toString()}`;
  const summaryRes = await fetchNcbi(summaryUrl, "PubMed MeSH summary");
  if (!summaryRes?.ok) return [];
  const summaryJson = (await summaryRes.json()) as MeshSummaryJson;
  return parseMeshSummaryJson(summaryJson, ids);
}

export function buildAssistedKeywordList(args: {
  originalKeywords: string[];
  correctedTerms?: Array<{ original: string; corrected: string }>;
  meshRecords?: PubmedMeshRecord[];
  maxEntryTermsPerRecord?: number;
  maxKeywords?: number;
}) {
  const maxEntryTerms = Math.max(
    0,
    Math.min(20, args.maxEntryTermsPerRecord ?? DEFAULT_MAX_ENTRY_TERMS_PER_RECORD),
  );
  const keywords = [
    ...args.originalKeywords,
    ...(args.correctedTerms ?? []).map((item) => item.corrected),
    ...(args.meshRecords ?? []).flatMap((record) => [
      record.name,
      ...record.entryTerms.slice(0, maxEntryTerms),
    ]),
  ];
  return dedupeForMatching(dedupeTerms(keywords), args.maxKeywords ?? 80);
}

export async function assistPubmedKeywords(
  keywords: string[],
  options: {
    maxTerms?: number;
    maxMeshRecordsPerTerm?: number;
    maxEntryTermsPerRecord?: number;
  } = {},
): Promise<PubmedKeywordAssistResult> {
  const cleaned = dedupeForMatching(keywords, options.maxTerms ?? DEFAULT_MAX_TERMS);
  if (!isPubmedAssistEnabled() || !cleaned.length) {
    return {
      keywords: dedupeForMatching(keywords, 80),
      correctedTerms: [],
      meshRecords: [],
      errors: [],
    };
  }

  const correctedTerms: PubmedKeywordAssistResult["correctedTerms"] = [];
  const meshRecords: PubmedMeshRecord[] = [];
  const errors: string[] = [];

  for (const keyword of cleaned) {
    let lookupTerm = keyword;
    try {
      const spell = await pubmedSpellCheck(keyword);
      if (spell?.hasSuggestion) {
        correctedTerms.push({
          original: spell.original,
          corrected: spell.corrected,
        });
        lookupTerm = spell.corrected;
      }
    } catch (error) {
      errors.push(`spell_check:${keyword}:${error instanceof Error ? error.message : "unknown"}`);
    }

    try {
      const records = await pubmedLookupMesh(lookupTerm, {
        maxResults: options.maxMeshRecordsPerTerm ?? DEFAULT_MAX_MESH_RECORDS_PER_TERM,
      });
      meshRecords.push(...records);
    } catch (error) {
      errors.push(`mesh_lookup:${lookupTerm}:${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  const assistedKeywords = buildAssistedKeywordList({
    originalKeywords: keywords,
    correctedTerms,
    meshRecords,
    maxEntryTermsPerRecord: options.maxEntryTermsPerRecord,
  });

  return {
    keywords: assistedKeywords,
    correctedTerms,
    meshRecords,
    errors,
  };
}
