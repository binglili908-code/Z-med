import { runEasyScholarSyncJob } from "@/lib/easyscholar";
import { parseCronIntegerParam } from "@/server/cron/parse-cron-params";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runCronRoute(req, () => {
    const batchSize = parseCronIntegerParam(req, "batchSize", {
      defaultValue: 30,
      min: 1,
      max: 100,
    });
    return runEasyScholarSyncJob({ batchSize });
  });
}
