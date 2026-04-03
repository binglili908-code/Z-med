export type PubmedPaper = {
  pmid: string;
  title: string;
  journal?: string;
  pubDate?: string;
  authors?: string[];
  url: string;
};

type DailyPapersResult = {
  featured: PubmedPaper | null;
  items: PubmedPaper[];
  query: string;
  fetchedAt: string;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x) => typeof x === "string") as string[];
  return out.length ? out : undefined;
}

function buildPubmedUrl(pmid: string) {
  return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`;
}

function buildDailyQuery() {
  const ai =
    '"artificial intelligence"[Title/Abstract] OR "machine learning"[Title/Abstract] OR "deep learning"[Title/Abstract] OR "foundation model"[Title/Abstract] OR "large language model"[Title/Abstract]';
  const med =
    '"medicine"[MeSH Terms] OR clinical[Title/Abstract] OR radiology[Title/Abstract] OR pathology[Title/Abstract] OR "electronic health record"[Title/Abstract] OR genomics[Title/Abstract]';
  const recency = '"last 7 days"[EDat]';
  return `(${ai}) AND (${med}) AND (${recency})`;
}

async function esearchPubmedIds(args: {
  term: string;
  retmax: number;
}): Promise<string[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    sort: "date",
    retmax: String(args.retmax),
    term: args.term,
  });

  const apiKey = process.env.NCBI_API_KEY;
  const tool = process.env.NCBI_TOOL;
  const email = process.env.NCBI_EMAIL;
  if (apiKey) params.set("api_key", apiKey);
  if (tool) params.set("tool", tool);
  if (email) params.set("email", email);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
  const res = await fetch(url, {
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as any;
  const list = json?.esearchresult?.idlist;
  if (!Array.isArray(list)) return [];
  return list.filter((x: unknown) => typeof x === "string");
}

async function esummaryPubmed(ids: string[]): Promise<PubmedPaper[]> {
  if (!ids.length) return [];
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    id: ids.join(","),
  });

  const apiKey = process.env.NCBI_API_KEY;
  const tool = process.env.NCBI_TOOL;
  const email = process.env.NCBI_EMAIL;
  if (apiKey) params.set("api_key", apiKey);
  if (tool) params.set("tool", tool);
  if (email) params.set("email", email);

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params.toString()}`;
  const res = await fetch(url, {
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as any;
  const result = json?.result;
  if (!result || typeof result !== "object") return [];

  const out: PubmedPaper[] = [];
  for (const id of ids) {
    const item = result[id];
    if (!item || typeof item !== "object") continue;
    const pmid = asString(item.uid) ?? id;
    const title = (asString(item.title) ?? "").trim();
    if (!title) continue;
    const journal = asString(item.fulljournalname) ?? asString(item.source);
    const pubDate = asString(item.pubdate);
    const authors =
      Array.isArray(item.authors) && item.authors.length
        ? item.authors
            .map((a: any) => asString(a?.name))
            .filter((x: string | undefined): x is string => Boolean(x))
        : undefined;

    out.push({
      pmid,
      title,
      journal,
      pubDate,
      authors,
      url: buildPubmedUrl(pmid),
    });
  }

  return out;
}

export async function getDailyPubmedPapers(
  opts: { limit?: number; query?: string } = {},
): Promise<DailyPapersResult> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 10));
  const query = (opts.query ?? buildDailyQuery()).trim();

  try {
    const ids = await esearchPubmedIds({ term: query, retmax: limit });
    const items = await esummaryPubmed(ids);
    const featured = items[0] ?? null;
    return {
      featured,
      items,
      query,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return {
      featured: null,
      items: [],
      query,
      fetchedAt: new Date().toISOString(),
    };
  }
}
