import { runAiAnalysisCronJob } from "@/lib/ai-analysis";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runCronRoute(req, () => runAiAnalysisCronJob());
}
