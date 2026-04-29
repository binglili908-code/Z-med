import { runGitHubModelHubSync } from "@/lib/github-model-hub";
import { parseCronBooleanParam, parseCronIntegerParam } from "@/server/cron/parse-cron-params";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  return runCronRoute(req, async () => {
    const queryLimit = parseCronIntegerParam(req, "queryLimit", {
      defaultValue: 8,
      min: 1,
      max: 8,
    });
    const perPage = parseCronIntegerParam(req, "perPage", {
      defaultValue: 30,
      min: 5,
      max: 60,
    });
    const dryRun = parseCronBooleanParam(req, "dryRun");

    const result = await runGitHubModelHubSync({
      queryLimit,
      perPage,
      dryRun,
    });
    return result;
  });
}
