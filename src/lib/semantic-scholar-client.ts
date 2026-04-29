import { fetchWithRetry } from "@/lib/external-fetch";

export type SemanticScholarPaper = {
  paperId?: string;
  corpusId?: number | string;
  externalIds?: Record<string, string | number | null> | null;
  url?: string | null;
  title?: string | null;
  abstract?: string | null;
  venue?: string | null;
  year?: number | null;
  referenceCount?: number | null;
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  isOpenAccess?: boolean | null;
  openAccessPdf?: {
    url?: string | null;
    status?: string | null;
  } | null;
  fieldsOfStudy?: string[] | null;
  s2FieldsOfStudy?: Array<{
    category?: string | null;
    source?: string | null;
  }> | null;
  publicationTypes?: string[] | null;
  publicationDate?: string | null;
  journal?: {
    name?: string | null;
    pages?: string | null;
    volume?: string | null;
  } | null;
};

type SemanticScholarBatchResponse = Array<SemanticScholarPaper | null>;

type SemanticScholarRecommendationsResponse = {
  recommendedPapers?: SemanticScholarPaper[];
};

const GRAPH_API_BASE_URL = "https://api.semanticscholar.org/graph/v1";
const RECOMMENDATIONS_API_BASE_URL = "https://api.semanticscholar.org/recommendations/v1";
const SEMANTIC_SCHOLAR_TIMEOUT_MS = 20000;
const SEMANTIC_SCHOLAR_FIELDS = [
  "paperId",
  "corpusId",
  "externalIds",
  "url",
  "title",
  "abstract",
  "venue",
  "year",
  "referenceCount",
  "citationCount",
  "influentialCitationCount",
  "isOpenAccess",
  "openAccessPdf",
  "fieldsOfStudy",
  "s2FieldsOfStudy",
  "publicationTypes",
  "publicationDate",
  "journal",
].join(",");

export function getSemanticScholarApiKey() {
  return process.env.SEMANTIC_SCHOLAR_API_KEY?.trim() || null;
}

function semanticScholarHeaders() {
  const apiKey = getSemanticScholarApiKey();
  if (!apiKey) {
    throw new Error("Missing SEMANTIC_SCHOLAR_API_KEY");
  }

  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
  };
}

async function fetchSemanticScholarJson<T>(url: string, init: RequestInit) {
  const res = await fetchWithRetry(url, {
    ...init,
    cache: "no-store",
    label: "Semantic Scholar API",
    retries: 2,
    retryDelayMs: 1000,
    timeoutMs: SEMANTIC_SCHOLAR_TIMEOUT_MS,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Semantic Scholar API returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

export async function fetchSemanticScholarPaperBatch(ids: string[]) {
  if (!ids.length) return [] as SemanticScholarBatchResponse;
  if (ids.length > 500) {
    throw new Error("Semantic Scholar paper batch accepts at most 500 ids");
  }

  const params = new URLSearchParams({ fields: SEMANTIC_SCHOLAR_FIELDS });
  return fetchSemanticScholarJson<SemanticScholarBatchResponse>(
    `${GRAPH_API_BASE_URL}/paper/batch?${params.toString()}`,
    {
      method: "POST",
      headers: semanticScholarHeaders(),
      body: JSON.stringify({ ids }),
    },
  );
}

export async function fetchSemanticScholarRecommendations(args: {
  positivePaperIds: string[];
  negativePaperIds?: string[];
  limit: number;
}) {
  if (!args.positivePaperIds.length) return [] as SemanticScholarPaper[];
  const limit = Math.max(1, Math.min(500, Math.floor(args.limit)));
  const params = new URLSearchParams({
    fields: SEMANTIC_SCHOLAR_FIELDS,
    limit: String(limit),
  });
  const response = await fetchSemanticScholarJson<SemanticScholarRecommendationsResponse>(
    `${RECOMMENDATIONS_API_BASE_URL}/papers?${params.toString()}`,
    {
      method: "POST",
      headers: semanticScholarHeaders(),
      body: JSON.stringify({
        positivePaperIds: args.positivePaperIds,
        negativePaperIds: args.negativePaperIds ?? [],
      }),
    },
  );

  return Array.isArray(response.recommendedPapers)
    ? response.recommendedPapers
    : [];
}
