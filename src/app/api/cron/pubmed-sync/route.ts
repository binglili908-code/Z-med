import { runAiAnalysisCronJob } from "@/lib/ai-analysis";
import { runPubmedSyncJob } from "@/lib/pubmed-sync";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runCronRoute(req, async () => {
    const result = await runPubmedSyncJob();
    const aiResult = await runAiAnalysisCronJob();
    return {
      ...result,
      aiAnalysis: aiResult,
    };
  });
}
