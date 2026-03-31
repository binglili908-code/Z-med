import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

type SeedRow = {
  journal_name: string;
  aliases: string[];
  tier: "top" | "core" | "emerging";
  weight: number;
  is_active: boolean;
};

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const CORE_TOP_JOURNALS: SeedRow[] = [
  { journal_name: "Cancer Letters", aliases: ["Cancer Lett"], tier: "top", weight: 0.9, is_active: true },
  { journal_name: "BMC Medicine", aliases: ["BMC Med"], tier: "top", weight: 0.9, is_active: true },
  { journal_name: "Journal of Translational Medicine", aliases: ["J Transl Med"], tier: "top", weight: 0.9, is_active: true },
  { journal_name: "npj Digital Medicine", aliases: ["npj Digit Med", "npj dm"], tier: "top", weight: 1.0, is_active: true },
  { journal_name: "npj Precision Oncology", aliases: ["npj Precis Oncol", "npj po"], tier: "top", weight: 1.0, is_active: true },
  { journal_name: "IEEE Journal of Biomedical and Health Informatics", aliases: ["IEEE J Biomed Health Inform", "JBHI"], tier: "top", weight: 0.95, is_active: true },
  { journal_name: "Cyborg and Bionic Systems", aliases: ["Cyborg Bionic Syst", "CBS"], tier: "core", weight: 0.78, is_active: true },
  { journal_name: "Journal of Advanced Research", aliases: ["J Adv Res", "JAR"], tier: "core", weight: 0.82, is_active: true },
  { journal_name: "Cancer Cell", aliases: ["Cancer Cell"], tier: "top", weight: 1.0, is_active: true },
  { journal_name: "Cancer Discovery", aliases: ["Cancer Discov"], tier: "top", weight: 1.0, is_active: true },
  { journal_name: "Nature Cardiovascular Research", aliases: ["Nat Cardiovasc Res"], tier: "top", weight: 0.96, is_active: true },
  { journal_name: "Cancer Communications", aliases: ["Cancer Commun (Lond)"], tier: "top", weight: 0.9, is_active: true },
  { journal_name: "IEEE Transactions on Medical Imaging", aliases: ["IEEE Trans Med Imaging", "TMI"], tier: "top", weight: 1.0, is_active: true },
  { journal_name: "IEEE Transactions on Cybernetics", aliases: ["IEEE Trans Cybern", "TCE"], tier: "core", weight: 0.82, is_active: true },
  { journal_name: "Advanced Materials", aliases: ["Adv Mater", "AM"], tier: "top", weight: 0.98, is_active: true },
  { journal_name: "Journal of Nanobiotechnology", aliases: ["J Nanobiotechnology", "JNB"], tier: "top", weight: 0.88, is_active: true },
  { journal_name: "The Lancet Oncology", aliases: ["Lancet Oncol"], tier: "top", weight: 1.0, is_active: true },
  { journal_name: "The Lancet Global Health", aliases: ["Lancet Glob Health"], tier: "top", weight: 1.0, is_active: true },
];

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase
    .from("journal_quality")
    .upsert(CORE_TOP_JOURNALS, { onConflict: "journal_name" });

  if (error) {
    throw new Error(error.message);
  }

  process.stdout.write(`Seeded journal_quality: ${CORE_TOP_JOURNALS.length}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
