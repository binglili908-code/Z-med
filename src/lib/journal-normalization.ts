export function normalizeJournalKey(input: string | null | undefined) {
  return getJournalKeyCandidates(input)[0] ?? "";
}

export function getJournalKeyCandidates(input: string | null | undefined) {
  const raw = (input ?? "").trim();
  if (!raw) return [] as string[];

  const base = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = new Set<string>();
  const add = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized) candidates.add(normalized);
  };

  add(base);
  add(base.replace(/^the\s+/, ""));

  const expandedDigital = base.replace(/\bdigit\b/g, "digital");
  add(expandedDigital);
  add(expandedDigital.replace(/^the\s+/, ""));

  return Array.from(candidates);
}
