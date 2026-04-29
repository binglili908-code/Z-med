import { runSemanticScholarPromotionDryRunJob } from "@/lib/semantic-scholar";
import {
  parseCronBooleanParam,
  parseCronIntegerParam,
} from "@/server/cron/parse-cron-params";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runCronRoute(req, () => {
    const limit = parseCronIntegerParam(req, "limit", {
      defaultValue: 20,
      min: 1,
      max: 100,
    });
    const includeRejected = parseCronBooleanParam(req, "includeRejected");
    const updateCandidates = !parseCronBooleanParam(req, "noUpdate");
    return runSemanticScholarPromotionDryRunJob({
      limit,
      includeRejected,
      updateCandidates,
    });
  });
}
