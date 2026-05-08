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

const MEDICAL_SPECIALTY_ALIAS_GROUPS: Array<{ keys: string[]; aliases: string[] }> = [
  {
    keys: ["\u6d88\u5316\u5185\u79d1", "\u6d88\u5316\u79d1", "\u80c3\u80a0"],
    aliases: [
      "gastroenterology",
      "gastrointestinal disease",
      "gastrointestinal diseases",
      "digestive system disease",
      "digestive diseases",
      "hepatology",
      "endoscopy",
      "inflammatory bowel disease",
      "colorectal disease",
    ],
  },
  {
    keys: ["\u53e3\u8154\u533b\u5b66", "\u53e3\u8154", "\u53e3\u8154\u79d1"],
    aliases: [
      "oral medicine",
      "dentistry",
      "dental medicine",
      "stomatology",
      "oral health",
      "periodontology",
      "orthodontics",
      "oral surgery",
      "maxillofacial surgery",
    ],
  },
  {
    keys: [
      "\u653e\u5c04\u5f71\u50cf",
      "\u653e\u5c04\u79d1",
      "\u533b\u5b66\u5f71\u50cf",
      "\u5f71\u50cf\u533b\u5b66",
    ],
    aliases: [
      "radiology",
      "medical imaging",
      "diagnostic imaging",
      "radiography",
      "computed tomography",
      "magnetic resonance imaging",
      "ct",
      "mri",
      "ultrasound",
      "interventional radiology",
    ],
  },
  {
    keys: ["\u7cbe\u795e\u533b\u5b66", "\u7cbe\u795e\u79d1"],
    aliases: [
      "psychiatry",
      "psychiatric",
      "mental health",
      "psychology",
      "depression",
      "schizophrenia",
      "bipolar disorder",
      "anxiety disorder",
      "psychosis",
    ],
  },
  {
    keys: ["\u6ccc\u5c3f\u5916\u79d1", "\u6ccc\u5c3f\u79d1", "\u6ccc\u5c3f"],
    aliases: [
      "urology",
      "urologic",
      "urological",
      "urinary tract",
      "prostate cancer",
      "bladder cancer",
      "kidney stone",
      "renal cell carcinoma",
    ],
  },
  {
    keys: ["\u62a4\u7406", "\u62a4\u7406\u5b66"],
    aliases: [
      "nursing",
      "nurse",
      "nurses",
      "nursing care",
      "patient care",
      "clinical nursing",
      "care management",
    ],
  },
  {
    keys: ["\u75c5\u7406", "\u75c5\u7406\u5b66", "\u75c5\u7406\u79d1"],
    aliases: [
      "pathology",
      "digital pathology",
      "histopathology",
      "pathological",
      "cytopathology",
      "whole slide imaging",
      "wsi",
      "pathology diagnosis",
    ],
  },
  {
    keys: ["\u513f\u79d1", "\u513f\u79d1\u5b66"],
    aliases: [
      "pediatrics",
      "paediatrics",
      "pediatric",
      "paediatric",
      "child health",
      "children",
      "neonatology",
      "adolescent medicine",
    ],
  },
  {
    keys: ["\u80be\u5185\u79d1", "\u80be\u75c5", "\u80be\u810f\u75c5"],
    aliases: [
      "nephrology",
      "kidney disease",
      "renal disease",
      "chronic kidney disease",
      "acute kidney injury",
      "dialysis",
      "hemodialysis",
      "glomerulonephritis",
    ],
  },
  {
    keys: ["\u611f\u67d3\u75c5", "\u611f\u67d3\u79d1"],
    aliases: [
      "infectious disease",
      "infectious diseases",
      "infection",
      "sepsis",
      "antimicrobial",
      "antibiotic",
      "viral infection",
      "bacterial infection",
      "covid-19",
    ],
  },
  {
    keys: ["\u6025\u8bca\u533b\u5b66", "\u6025\u8bca"],
    aliases: [
      "emergency medicine",
      "emergency department",
      "emergency care",
      "emergency service",
      "triage",
      "trauma",
      "resuscitation",
      "acute care",
    ],
  },
  {
    keys: [
      "\u91cd\u75c7\u533b\u5b66",
      "\u91cd\u75c7",
      "\u91cd\u75c7\u76d1\u62a4",
    ],
    aliases: [
      "critical care",
      "intensive care",
      "intensive care unit",
      "icu",
      "critical illness",
      "mechanical ventilation",
      "sepsis",
      "shock",
    ],
  },
  {
    keys: ["\u8001\u5e74\u533b\u5b66", "\u8001\u5e74\u79d1"],
    aliases: [
      "geriatrics",
      "geriatric medicine",
      "gerontology",
      "older adults",
      "elderly",
      "aging",
      "frailty",
      "dementia",
    ],
  },
  {
    keys: ["\u76ae\u80a4\u79d1", "\u76ae\u80a4"],
    aliases: [
      "dermatology",
      "skin disease",
      "skin diseases",
      "dermatologic",
      "melanoma",
      "psoriasis",
      "eczema",
      "atopic dermatitis",
    ],
  },
  {
    keys: ["\u9aa8\u79d1", "\u9aa8\u5916\u79d1"],
    aliases: [
      "orthopedics",
      "orthopaedics",
      "orthopedic",
      "orthopaedic",
      "bone fracture",
      "fracture",
      "arthroplasty",
      "joint replacement",
      "spine surgery",
      "sports medicine",
    ],
  },
  {
    keys: [
      "\u98ce\u6e7f\u514d\u75ab",
      "\u98ce\u6e7f\u79d1",
      "\u514d\u75ab\u79d1",
    ],
    aliases: [
      "rheumatology",
      "immunology",
      "autoimmune disease",
      "autoimmune diseases",
      "rheumatoid arthritis",
      "systemic lupus erythematosus",
      "sle",
      "vasculitis",
      "ankylosing spondylitis",
    ],
  },
  {
    keys: ["\u8840\u6db2\u79d1", "\u8840\u6db2\u5185\u79d1", "\u8840\u6db2\u75c5"],
    aliases: [
      "hematology",
      "haematology",
      "blood disease",
      "blood diseases",
      "leukemia",
      "lymphoma",
      "multiple myeloma",
      "anemia",
      "thrombosis",
    ],
  },
  {
    keys: ["\u80bf\u7624\u5b66", "\u80bf\u7624", "\u80bf\u7624\u79d1"],
    aliases: [
      "oncology",
      "cancer",
      "neoplasm",
      "neoplasms",
      "tumor",
      "tumour",
      "carcinoma",
      "malignancy",
      "radiotherapy",
      "chemotherapy",
      "immunotherapy",
    ],
  },
  {
    keys: ["\u751f\u6b96\u533b\u5b66", "\u751f\u6b96"],
    aliases: [
      "reproductive medicine",
      "fertility",
      "infertility",
      "assisted reproduction",
      "ivf",
      "in vitro fertilization",
      "obstetrics",
      "gynecology",
      "embryology",
    ],
  },
  {
    keys: [
      "\u5168\u79d1\u533b\u5b66",
      "\u521d\u7ea7\u4fdd\u5065",
      "\u5168\u79d1",
      "\u5168\u79d1\u533b\u5b66\u521d\u7ea7\u4fdd\u5065",
    ],
    aliases: [
      "general practice",
      "family medicine",
      "primary care",
      "primary health care",
      "general practitioner",
      "community health",
      "ambulatory care",
    ],
  },
];

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
  "\u773c\u79d1": [
    "ophthalmology",
    "ophthalmological",
    "ophthalmic",
    "ocular",
    "eye disease",
    "eye diseases",
    "fundus",
    "optical coherence tomography",
    "retina",
    "retinal",
    "macular degeneration",
    "diabetic retinopathy",
    "glaucoma",
    "cataract",
  ],
};

const JOURNAL_ALIASES: Record<string, string[]> = {
  ejves: ["european journal of vascular and endovascular surgery", "ejves"],
  jvs: ["journal of vascular surgery", "jvs"],
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

function specialtyAliasesForKey(key: string) {
  return MEDICAL_SPECIALTY_ALIAS_GROUPS.flatMap((group) =>
    group.keys.includes(key) ? group.aliases : [],
  );
}

function journalAliasesForKey(key: string) {
  return JOURNAL_ALIASES[key] ?? [];
}

export function expandSubscriptionTerms(values: string[] | null | undefined) {
  const terms = new Set<string>();

  for (const raw of values ?? []) {
    const normalized = normalizeMatchText(raw);
    if (!normalized) continue;
    terms.add(normalized);
    terms.add(compactText(normalized));

    const key = compactText(normalized);
    for (const alias of [
      ...(SUBSCRIPTION_ALIASES[key] ?? []),
      ...specialtyAliasesForKey(key),
    ]) {
      const aliasNormalized = normalizeMatchText(alias);
      if (aliasNormalized) {
        terms.add(aliasNormalized);
        terms.add(compactText(aliasNormalized));
      }
    }
  }

  return Array.from(terms).filter(Boolean);
}

export function expandJournalTerms(values: string[] | null | undefined) {
  const terms = new Set<string>();

  for (const raw of values ?? []) {
    const normalized = normalizeMatchText(raw);
    if (!normalized) continue;
    terms.add(normalized);
    terms.add(compactText(normalized));

    const key = compactText(normalized);
    for (const alias of journalAliasesForKey(key)) {
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
