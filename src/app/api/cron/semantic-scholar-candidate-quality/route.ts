import { runSemanticScholarCandidateQualityRefreshJob } from "@/lib/semantic-scholar";
import { parseCronIntegerParam } from "@/server/cron/parse-cron-params";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runCronRoute(req, () => {
    const limit = parseCronIntegerParam(req, "limit", {
      defaultValue: 500,
      min: 1,
      max: 2000,
    });
    return runSemanticScholarCandidateQualityRefreshJob({ limit });
  });
}
