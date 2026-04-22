export type JournalDynamicScoreInput = {
  aiMedScore: number;
  baseWeight: number | null | undefined;
  impactFactor?: number | string | null;
  jcrQuartile?: string | null;
  casZone?: string | null;
};

export type JournalDynamicScoreOutput = {
  journalWeight: number;
  qualityScore: number;
  ifFactor: number;
  zoneFactor: number;
  impactFactor: number | null;
  jcrQuartile: string | null;
  casZone: string | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normalizeZoneText(text?: string | null) {
  const v = (text ?? "").trim();
  return v ? v : null;
}

function parseZoneLevelFromText(text?: string | null): 1 | 2 | 3 | 4 | null {
  const value = (text ?? "").trim();
  if (!value) return null;
  const q = value.match(/\bQ([1-4])\b/i);
  if (q?.[1]) return Number(q[1]) as 1 | 2 | 3 | 4;
  const n = value.match(/([1-4])\s*区/);
  if (n?.[1]) return Number(n[1]) as 1 | 2 | 3 | 4;
  const cnMap: Record<string, 1 | 2 | 3 | 4> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
  };
  const cn = value.match(/([一二三四])\s*区/);
  if (cn?.[1] && cnMap[cn[1]]) return cnMap[cn[1]];
  return null;
}

function ifFactorFromImpact(impactFactor: number | null) {
  if (impactFactor == null) return 1;
  if (impactFactor < 3) return 0.95;
  if (impactFactor < 8) return 1;
  if (impactFactor < 15) return 1.08;
  if (impactFactor < 30) return 1.15;
  return 1.2;
}

function zoneFactorFromLevel(level: 1 | 2 | 3 | 4 | null) {
  if (level === 1) return 1.12;
  if (level === 2) return 1;
  if (level === 3) return 0.9;
  if (level === 4) return 0.8;
  return 1;
}

export function computeDynamicQualityScore(
  args: JournalDynamicScoreInput,
): JournalDynamicScoreOutput {
  const baseWeight = Number(args.baseWeight ?? 0.5);
  const safeBaseWeight = Number.isFinite(baseWeight) ? baseWeight : 0.5;

  const impactFactor = toNumber(args.impactFactor);
  const jcrQuartile = normalizeZoneText(args.jcrQuartile);
  const casZone = normalizeZoneText(args.casZone);

  const zoneLevel = parseZoneLevelFromText(casZone) ?? parseZoneLevelFromText(jcrQuartile);
  const ifFactor = ifFactorFromImpact(impactFactor);
  const zoneFactor = zoneFactorFromLevel(zoneLevel);

  const journalWeight = Number(clamp(safeBaseWeight * ifFactor * zoneFactor, 0.3, 1.2).toFixed(4));
  const qualityScore = Number((Math.max(0, args.aiMedScore || 0) * journalWeight).toFixed(4));

  return {
    journalWeight,
    qualityScore,
    ifFactor,
    zoneFactor,
    impactFactor,
    jcrQuartile,
    casZone,
  };
}
