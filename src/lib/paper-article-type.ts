type ArticleTypePaper = {
  title?: string | null;
  abstract?: string | null;
  keywords?: string[] | null;
  mesh_terms?: string[] | null;
  source_payload?: Record<string, unknown> | null;
};

const PUBLICATION_TYPE_KEYS = [
  "pubtype",
  "pubtypes",
  "publicationtype",
  "publicationtypes",
  "publication_type",
  "publication_types",
  "article_type",
  "article_types",
];

const REVIEW_TYPE_PATTERNS = [
  /\breview\b/i,
  /\bsystematic\s+review\b/i,
  /\bscoping\s+review\b/i,
  /\bliterature\s+review\b/i,
  /\bnarrative\s+review\b/i,
  /\bumbrella\s+review\b/i,
  /\bmeta[-\s]?analysis\b/i,
];

const TITLE_REVIEW_PATTERNS = [
  /\bsystematic\s+review\b/i,
  /\bscoping\s+review\b/i,
  /\bliterature\s+review\b/i,
  /\bnarrative\s+review\b/i,
  /\bumbrella\s+review\b/i,
  /\bmeta[-\s]?analysis\b/i,
  /:\s*(a\s+)?review\b/i,
  /\b(a|an)\s+review\s+of\b/i,
  /\breview\s+and\s+meta[-\s]?analysis\b/i,
];

function normalizeText(input: string) {
  return input.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item));
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  return ["name", "value", "label", "type", "publication_type"]
    .flatMap((key) => collectStrings(record[key]));
}

export function getPublicationTypesFromPayload(
  payload: Record<string, unknown> | null | undefined,
) {
  if (!payload) return [] as string[];

  const values = PUBLICATION_TYPE_KEYS.flatMap((key) => collectStrings(payload[key]));
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

export function isReviewLikePublicationType(type: string) {
  const normalized = normalizeText(type);
  return REVIEW_TYPE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isReviewLikeTitle(title: string | null | undefined) {
  const normalized = normalizeText(title ?? "");
  if (!normalized) return false;
  return TITLE_REVIEW_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isReviewLikePaper(paper: ArticleTypePaper) {
  const publicationTypes = getPublicationTypesFromPayload(paper.source_payload);
  if (publicationTypes.some(isReviewLikePublicationType)) return true;

  return isReviewLikeTitle(paper.title);
}

export function filterReviewLikePapers<T extends ArticleTypePaper>(
  papers: T[],
  excludeReviews: boolean,
) {
  return excludeReviews ? papers.filter((paper) => !isReviewLikePaper(paper)) : papers;
}
