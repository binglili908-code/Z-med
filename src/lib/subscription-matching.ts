const STOP_WORDS_FOR_ACRONYM = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
]);

const SUBSCRIPTION_ALIASES: Record<string, string[]> = {
  cad: ["coronary artery disease", "coronary heart disease", "ischemic heart disease"],
  ckd: ["chronic kidney disease"],
  copd: ["chronic obstructive pulmonary disease"],
  ecg: ["electrocardiogram", "electrocardiography"],
  ehr: ["electronic health record", "electronic medical record"],
  ejves: [
    "european journal of vascular and endovascular surgery",
    "vascular surgery",
    "endovascular surgery",
  ],
  emr: ["electronic medical record", "electronic health record"],
  hcc: ["hepatocellular carcinoma", "liver cancer"],
  icu: ["intensive care unit", "critical care"],
  jvs: ["journal of vascular surgery", "vascular surgery", "endovascular surgery"],
  llm: ["large language model", "large language models", "gpt"],
  mri: ["magnetic resonance imaging"],
  nlp: ["natural language processing"],
  pdac: ["pancreatic ductal adenocarcinoma", "pancreatic cancer", "pancreatic neoplasms"],
  pet: ["positron emission tomography"],
  rct: ["randomized controlled trial", "randomised controlled trial"],
  sle: ["systemic lupus erythematosus"],
  "\u80f0\u817a\u764c": [
    "pancreatic cancer",
    "pancreatic ductal adenocarcinoma",
    "pancreatic neoplasms",
  ],
  "\u8840\u7ba1": [
    "vascular surgery",
    "endovascular surgery",
    "vascular disease",
    "blood vessel",
  ],
};

const BROAD_TOPIC_TERMS = new Set([
  "blood vessel",
  "blood vessels",
  "bloodvessel",
  "bloodvessels",
  "vascular",
  "vessel",
  "vessels",
  "\u8840\u7ba1",
]);

export function normalizeMatchText(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(input: string) {
  return normalizeMatchText(input).replace(/\s+/g, "");
}

export function expandSubscriptionTerms(values: string[] | null | undefined) {
  const terms = new Set<string>();

  for (const raw of values ?? []) {
    const normalized = normalizeMatchText(raw);
    if (!normalized) continue;
    terms.add(normalized);
    terms.add(compactText(normalized));

    for (const alias of SUBSCRIPTION_ALIASES[compactText(normalized)] ?? []) {
      const aliasNormalized = normalizeMatchText(alias);
      if (aliasNormalized) {
        terms.add(aliasNormalized);
        terms.add(compactText(aliasNormalized));
      }
    }
  }

  return Array.from(terms).filter(Boolean);
}

export function buildSearchText(values: Array<string | null | undefined>) {
  return normalizeMatchText(values.filter(Boolean).join("\n"));
}

export function textMatchesAnyTerm(text: string, terms: string[]) {
  if (!terms.length) return true;
  const normalized = normalizeMatchText(text);
  const compact = compactText(text);

  return terms.some((term) => {
    const normalizedTerm = normalizeMatchText(term);
    const compactTerm = compactText(term);
    return (
      Boolean(normalizedTerm && normalized.includes(normalizedTerm)) ||
      Boolean(compactTerm && compact.includes(compactTerm))
    );
  });
}

export function hasBroadTopicTerm(terms: string[]) {
  return terms.some((term) => {
    const normalized = normalizeMatchText(term);
    const compact = compactText(term);
    return BROAD_TOPIC_TERMS.has(normalized) || BROAD_TOPIC_TERMS.has(compact);
  });
}

function journalAcronym(journal: string) {
  const primaryTitle = journal.split(/[:.;]/)[0] ?? journal;
  const words = normalizeMatchText(primaryTitle)
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS_FOR_ACRONYM.has(word));

  return words.map((word) => word[0]).join("");
}

function hasAdjacentTransposition(left: string, right: string) {
  if (left.length !== right.length) return false;
  const diffs: number[] = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) diffs.push(index);
  }
  return (
    diffs.length === 2 &&
    diffs[1] === diffs[0] + 1 &&
    left[diffs[0]] === right[diffs[1]] &&
    left[diffs[1]] === right[diffs[0]]
  );
}

function isOneEditAway(left: string, right: string) {
  if (left === right) return true;
  if (hasAdjacentTransposition(left, right)) return true;
  if (Math.abs(left.length - right.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  return edits + (left.length - i) + (right.length - j) <= 1;
}

function acronymMatchesTerm(acronym: string, compactTerm: string) {
  if (!acronym || !compactTerm) return false;
  if (acronym === compactTerm) return true;
  if (acronym.length < 4 || compactTerm.length < 4) return false;
  if (Math.max(acronym.length, compactTerm.length) > 8) return false;
  return isOneEditAway(acronym, compactTerm);
}

export function journalMatchesAnyTerm(journal: string | null | undefined, terms: string[]) {
  if (!terms.length) return true;
  const journalText = journal ?? "";
  const normalized = normalizeMatchText(journalText);
  const compact = compactText(journalText);
  const acronym = journalAcronym(journalText);

  return terms.some((term) => {
    const normalizedTerm = normalizeMatchText(term);
    const compactTerm = compactText(term);
    return (
      Boolean(normalizedTerm && normalized.includes(normalizedTerm)) ||
      Boolean(compactTerm && compact.includes(compactTerm)) ||
      Boolean(compactTerm && acronymMatchesTerm(acronym, compactTerm))
    );
  });
}
