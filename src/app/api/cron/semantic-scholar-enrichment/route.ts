import { runSemanticScholarEnrichmentJob } from "@/lib/semantic-scholar";
import { parseCronIntegerParam } from "@/server/cron/parse-cron-params";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runCronRoute(req, () => {
    const batchSize = parseCronIntegerParam(req, "batchSize", {
      defaultValue: 100,
      min: 1,
      max: 300,
    });
    const staleDays = parseCronIntegerParam(req, "staleDays", {
      defaultValue: 30,
      min: 1,
      max: 180,
    });
    return runSemanticScholarEnrichmentJob({ batchSize, staleDays });
  });
}
