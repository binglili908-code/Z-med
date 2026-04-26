import { runAiAnalysisCronJob } from "@/lib/ai-analysis";
import { runJournalSyncJob } from "@/lib/pubmed-sync";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runCronRoute(req, async () => {
    const result = await runJournalSyncJob();
    const aiResult = await runAiAnalysisCronJob();
    return {
      ...result,
      aiAnalysis: aiResult,
    };
  });
}
