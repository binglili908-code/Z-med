import { runSubscriptionNormalizationBackfill } from "@/lib/subscription-normalization-backfill";
import { parseCronIntegerParam } from "@/server/cron/parse-cron-params";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runCronRoute(req, async () => {
    const limit = parseCronIntegerParam(req, "limit", {
      defaultValue: 10,
      min: 1,
      max: 50,
    });

    return runSubscriptionNormalizationBackfill({ limit });
  });
}
