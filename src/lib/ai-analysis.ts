import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { callMiniMaxChat, getMiniMaxApiKey } from "@/lib/minimax";
import {
  enqueueMissingPlatformAnalysisJobs,
  getAiAnalysisPapersByIds,
  listRunnablePlatformAnalysisJobs,
  markAiAnalysisJobCompleted,
  markAiAnalysisJobFailed,
  markAiAnalysisJobProcessing,
  updatePaperTranslations,
  type AiAnalysisPaperRow,
} from "@/server/repositories/ai-analysis";

const MODEL_NAME = "MiniMax-Text-01";
const MAX_BATCH_SIZE = 20;
const SYSTEM_PROMPT = `你是一位专业的医学翻译。请将以下英文医学论文摘要翻译为准确、流畅的中文。
要求：
1. 专业术语使用标准中文医学翻译
2. 保持原文的逻辑结构和信息完整性
3. 不要添加任何解读、评论或总结，只做翻译
4. 直接输出翻译后的中文文本，不要加引号或标记`;

async function callMiniMaxAnalysis(paper: AiAnalysisPaperRow) {
  const userPrompt = `论文标题：${paper.title}
期刊：${paper.journal ?? "Unknown"}
摘要原文：${paper.abstract ?? "无摘要"}`;

  const response = await callMiniMaxChat({
    model: MODEL_NAME,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.1,
    maxTokens: 2400,
  });
  const content = response.content;
  if (!content) {
    throw new Error("MiniMax response has no content");
  }
  return content.trim();
}

async function callMiniMaxTitle(title: string, journal: string | null) {
  const system = `你是一位专业的医学翻译。请将下面英文论文标题翻译为准确、简洁的中文标题。仅输出中文标题，不要添加任何说明或标记。`;
  const user = `期刊：${journal ?? "Unknown"}
英文标题：${title}`;
  const res = await callMiniMaxChat({
    model: MODEL_NAME,
    systemPrompt: system,
    userPrompt: user,
    temperature: 0.1,
    maxTokens: 200,
  });
  const content = res.content?.trim() ?? "";
  if (!content) {
    throw new Error("MiniMax title response has no content");
  }
  return content.trim();
}

export async function runAiAnalysisCronJob() {
  const supabase = createServiceSupabaseClient();
  const hasMiniMaxApiKey = Boolean(getMiniMaxApiKey());
  const { enqueuedCount } = await enqueueMissingPlatformAnalysisJobs(supabase);
  const jobs = await listRunnablePlatformAnalysisJobs(supabase, {
    scanLimit: 100,
    batchSize: MAX_BATCH_SIZE,
  });

  if (!jobs.length) {
    return {
      enqueuedCount,
      processed: 0,
      completed: 0,
      failed: 0,
      model: MODEL_NAME,
      hasMiniMaxApiKey,
      hasTranslationApiKey: hasMiniMaxApiKey,
    };
  }

  const paperMap = await getAiAnalysisPapersByIds(
    supabase,
    jobs.map((job) => job.paper_id),
  );
  let completed = 0;
  let failed = 0;
  const failures: Array<{ queueId: string; paperId: string; error: string }> = [];

  for (const job of jobs) {
    const attemptsNow = (job.attempts ?? 0) + 1;
    await markAiAnalysisJobProcessing(supabase, job.id);

    const paper = paperMap.get(job.paper_id);
    if (!paper) {
      await markAiAnalysisJobFailed(supabase, job.id, attemptsNow, "paper not found");
      failed += 1;
      failures.push({ queueId: job.id, paperId: job.paper_id, error: "paper not found" });
      continue;
    }

    try {
      let abstractZh: string | null = null;
      let titleZh: string | null = null;

      if (!paper.abstract_zh) {
        const translated = await callMiniMaxAnalysis(paper);
        abstractZh = translated;
      }

      if (!paper.title_zh) {
        try {
          titleZh = await callMiniMaxTitle(paper.title, paper.journal);
        } catch {
          titleZh = null;
        }
      }

      await updatePaperTranslations(supabase, {
        paperId: paper.id,
        abstractZh,
        titleZh,
      });
      await markAiAnalysisJobCompleted(supabase, job.id, attemptsNow);
      completed += 1;
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e);
      await markAiAnalysisJobFailed(supabase, job.id, attemptsNow, errText);
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
    hasMiniMaxApiKey,
    hasTranslationApiKey: hasMiniMaxApiKey,
    failures,
  };
}
