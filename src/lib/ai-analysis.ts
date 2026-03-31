import fs from "node:fs";
import path from "node:path";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type PaperRow = {
  id: string;
  title: string;
  journal: string | null;
  abstract: string | null;
  quality_score: number | null;
};

type QueueRow = {
  id: string;
  paper_id: string;
  attempts: number | null;
  max_attempts: number | null;
  priority: number | null;
  status: string;
};

type AiAnalysisResult = {
  summary_zh: string;
  background: string;
  method: string;
  value: string;
};

const MODEL_NAME = "deepseek-chat";
const ANALYSIS_VERSION = "v1";
const MAX_BATCH_SIZE = 20;
const SYSTEM_PROMPT = `你是一位 AI 与医学交叉领域的资深科研顾问。请基于给定论文信息，用中文生成结构化解读。请严格输出 JSON 对象，不要输出任何其他内容。`;

function readLocalEnvValue(name: string) {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const files = [
      path.join(process.cwd(), ".env.local"),
      path.join(process.cwd(), "zlab-web", ".env.local"),
      path.join(__dirname, "..", "..", "..", ".env.local"),
    ];
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        if (!t.startsWith(`${name}=`)) continue;
        const value = t.slice(name.length + 1).trim();
        if (value) return value;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function getDeepSeekApiKey() {
  const runtimeKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (runtimeKey) return runtimeKey;
  const localKey = readLocalEnvValue("DEEPSEEK_API_KEY");
  if (localKey) return localKey;
  return null;
}

function toQueuePriority(qualityScore: unknown) {
  const v = Number(qualityScore ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.round(v * 10000));
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      return JSON.parse(slice);
    }
    throw new Error("Model output is not valid JSON");
  }
}

function toAiAnalysisObject(obj: unknown): AiAnalysisResult {
  const data = (obj ?? {}) as Record<string, unknown>;
  const summary_zh = typeof data.summary_zh === "string" ? data.summary_zh.trim() : "";
  const background = typeof data.background === "string" ? data.background.trim() : "";
  const method = typeof data.method === "string" ? data.method.trim() : "";
  const value = typeof data.value === "string" ? data.value.trim() : "";
  if (!summary_zh || !background || !method || !value) {
    throw new Error("Model JSON missing required fields");
  }
  return { summary_zh, background, method, value };
}

async function callDeepSeekAnalysis(paper: PaperRow) {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }

  const userPrompt = `论文标题：${paper.title}
期刊：${paper.journal ?? "Unknown"}
摘要：${paper.abstract ?? "无摘要"}

请严格按以下 JSON 格式输出（不要输出任何其他内容）：
{
  "summary_zh": "用 2-3 句中文概括这篇论文在做什么",
  "background": "这项研究的背景和动机是什么？解决了什么痛点？（2-3 句）",
  "method": "核心技术方法是什么？创新点在哪？（2-3 句）",
  "value": "这项研究对临床医生或科研人员有什么实际价值？（2-3 句）"
}`;

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`DeepSeek request failed: ${response.status} ${raw.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek response has no content");
  }
  const parsed = extractJsonObject(content);
  return toAiAnalysisObject(parsed);
}

async function ensurePlatformQueue(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const { data: candidates, error: candidateErr } = await supabase
    .from("papers")
    .select("id,quality_score")
    .eq("is_ai_med", true)
    .is("ai_analysis", null)
    .order("quality_score", { ascending: false })
    .limit(200);
  if (candidateErr) {
    throw new Error(`Load papers for AI queue failed: ${candidateErr.message}`);
  }

  const paperIds = (candidates ?? []).map((r) => r.id);
  if (!paperIds.length) {
    return { enqueuedCount: 0 };
  }

  const { data: existingRows, error: existingErr } = await supabase
    .from("ai_analysis_queue")
    .select("paper_id")
    .eq("provider", "platform")
    .is("user_id", null)
    .in("paper_id", paperIds);
  if (existingErr) {
    throw new Error(`Load existing AI queue failed: ${existingErr.message}`);
  }

  const existing = new Set((existingRows ?? []).map((r) => r.paper_id));
  const insertRows = (candidates ?? [])
    .filter((r) => !existing.has(r.id))
    .map((r) => ({
      paper_id: r.id,
      user_id: null,
      provider: "platform",
      status: "pending",
      priority: toQueuePriority(r.quality_score),
      attempts: 0,
      max_attempts: 3,
    }));

  if (!insertRows.length) {
    return { enqueuedCount: 0 };
  }

  const { error: insertErr } = await supabase.from("ai_analysis_queue").insert(insertRows);
  if (insertErr) {
    throw new Error(`Insert AI queue failed: ${insertErr.message}`);
  }
  return { enqueuedCount: insertRows.length };
}

export async function runAiAnalysisCronJob() {
  const supabase = createServiceSupabaseClient();
  const hasDeepseekApiKey = Boolean(getDeepSeekApiKey());
  const { enqueuedCount } = await ensurePlatformQueue(supabase);

  const { data: queueRows, error: queueErr } = await supabase
    .from("ai_analysis_queue")
    .select("id,paper_id,attempts,max_attempts,priority,status")
    .eq("provider", "platform")
    .is("user_id", null)
    .in("status", ["pending", "failed"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(100);
  if (queueErr) {
    throw new Error(`Load AI queue jobs failed: ${queueErr.message}`);
  }

  const jobs = ((queueRows ?? []) as QueueRow[])
    .filter((j) => (j.attempts ?? 0) < (j.max_attempts ?? 3))
    .slice(0, MAX_BATCH_SIZE);

  if (!jobs.length) {
    return {
      enqueuedCount,
      processed: 0,
      completed: 0,
      failed: 0,
      model: MODEL_NAME,
      hasDeepseekApiKey,
    };
  }

  const paperIds = jobs.map((j) => j.paper_id);
  const { data: papers, error: paperErr } = await supabase
    .from("papers")
    .select("id,title,journal,abstract,quality_score")
    .in("id", paperIds);
  if (paperErr) {
    throw new Error(`Load papers for AI jobs failed: ${paperErr.message}`);
  }

  const paperMap = new Map((papers ?? []).map((p) => [p.id, p as PaperRow]));
  let completed = 0;
  let failed = 0;
  const failures: Array<{ queueId: string; paperId: string; error: string }> = [];

  for (const job of jobs) {
    const attemptsNow = (job.attempts ?? 0) + 1;
    await supabase
      .from("ai_analysis_queue")
      .update({ status: "processing" })
      .eq("id", job.id);

    const paper = paperMap.get(job.paper_id);
    if (!paper) {
      await supabase
        .from("ai_analysis_queue")
        .update({ status: "failed", attempts: attemptsNow })
        .eq("id", job.id);
      failed += 1;
      failures.push({ queueId: job.id, paperId: job.paper_id, error: "paper not found" });
      continue;
    }

    try {
      const analysis = await callDeepSeekAnalysis(paper);
      const payload = {
        ...analysis,
        model_used: MODEL_NAME,
        generated_at: new Date().toISOString(),
        version: ANALYSIS_VERSION,
      };

      const { error: updatePaperErr } = await supabase
        .from("papers")
        .update({
          ai_analysis: payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paper.id);
      if (updatePaperErr) {
        throw new Error(updatePaperErr.message);
      }

      const { error: queueDoneErr } = await supabase
        .from("ai_analysis_queue")
        .update({ status: "completed", attempts: attemptsNow })
        .eq("id", job.id);
      if (queueDoneErr) {
        throw new Error(queueDoneErr.message);
      }
      completed += 1;
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e);
      await supabase
        .from("ai_analysis_queue")
        .update({ status: "failed", attempts: attemptsNow })
        .eq("id", job.id);
      failed += 1;
      failures.push({ queueId: job.id, paperId: job.paper_id, error: errText.slice(0, 280) });
    }
  }

  return {
    enqueuedCount,
    processed: jobs.length,
    completed,
    failed,
    model: MODEL_NAME,
    hasDeepseekApiKey,
    failures,
  };
}
