export const AI_TERMS = [
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

export const MED_TERMS = [
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

export const TOPIC_KEYWORD_LIBRARY: Record<string, string[]> = {
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

export function normalizeToken(input: string) {
  return input.trim().toLowerCase();
}

export function dedupeTerms(terms: string[]) {
  return Array.from(new Set(terms.map((t) => normalizeToken(t)).filter(Boolean)));
}

export function findTermMatches(text: string, terms: string[]) {
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
