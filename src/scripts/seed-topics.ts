import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

type TopicSeed = {
  slug: string;
  name_zh: string;
  name_en: string;
  description: string;
  sort_order: number;
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
    if (!(key in process.env)) process.env[key] = value;
  }
}

const TOPICS: TopicSeed[] = [
  {
    slug: "medical-imaging-digital-pathology",
    name_zh: "医学影像与数字病理",
    name_en: "Medical Imaging & Digital Pathology",
    description: "CT/MRI/超声/病理切片的检测、分割与定量分析",
    sort_order: 1,
    is_active: true,
  },
  {
    slug: "medical-llm-clinical-nlp",
    name_zh: "医疗大模型与临床NLP",
    name_en: "Medical LLMs & Clinical NLP",
    description: "病历理解、问答、摘要、信息抽取与临床文本智能",
    sort_order: 2,
    is_active: true,
  },
  {
    slug: "bioinformatics-multiomics",
    name_zh: "生物信息与多组学",
    name_en: "Bioinformatics & Multi-omics",
    description: "基因组、蛋白组、单细胞等多组学数据建模与解释",
    sort_order: 3,
    is_active: true,
  },
  {
    slug: "ai-drug-discovery",
    name_zh: "AI制药与靶点发现",
    name_en: "AI Drug Discovery / AI4Science",
    description: "分子生成、靶点发现、虚拟筛选、结构预测",
    sort_order: 4,
    is_active: true,
  },
  {
    slug: "clinical-decision-support",
    name_zh: "临床预测与决策支持",
    name_en: "Clinical Decision Support",
    description: "风险预测、ICU预警、并发症评估与临床决策辅助",
    sort_order: 5,
    is_active: true,
  },
];

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from("research_topics").upsert(TOPICS, {
    onConflict: "slug",
  });
  if (error) throw new Error(error.message);

  process.stdout.write(`Seeded research_topics: ${TOPICS.length}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
