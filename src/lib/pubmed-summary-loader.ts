import {
  chunk,
  enrichSummariesWithAbstracts,
  pubmedEsummary,
  randomDelay,
  type PubmedSummary,
} from "@/lib/pubmed-sync-client";

type LoadPubmedSummariesOptions = {
  chunkSize?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
  includeAbstracts?: boolean;
};

export async function loadPubmedSummariesByIds(
  ids: string[],
  options: LoadPubmedSummariesOptions = {},
): Promise<PubmedSummary[]> {
  const chunkSize = options.chunkSize ?? 20;
  const delayMinMs = options.delayMinMs ?? 180;
  const delayMaxMs = options.delayMaxMs ?? 320;

  const summaries: PubmedSummary[] = [];
  for (const group of chunk(ids, chunkSize)) {
    const part = await pubmedEsummary(group);
    summaries.push(...part);
    await randomDelay(delayMinMs, delayMaxMs);
  }

  if (options.includeAbstracts ?? true) {
    await enrichSummariesWithAbstracts(summaries);
  }
  return summaries;
}
