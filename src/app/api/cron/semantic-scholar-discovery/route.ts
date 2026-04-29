import { runSemanticScholarDiscoveryJob } from "@/lib/semantic-scholar";
import { parseCronIntegerParam } from "@/server/cron/parse-cron-params";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runCronRoute(req, () => {
    const seedLimit = parseCronIntegerParam(req, "seedLimit", {
      defaultValue: 10,
      min: 1,
      max: 30,
    });
    const recommendationLimit = parseCronIntegerParam(req, "recommendationLimit", {
      defaultValue: 50,
      min: 1,
      max: 200,
    });
    const minSeedCitationCount = parseCronIntegerParam(req, "minSeedCitationCount", {
      defaultValue: 5,
      min: 0,
      max: 10000,
    });
    const candidateTtlDays = parseCronIntegerParam(req, "candidateTtlDays", {
      defaultValue: 30,
      min: 1,
      max: 90,
    });
    return runSemanticScholarDiscoveryJob({
      seedLimit,
      recommendationLimit,
      minSeedCitationCount,
      candidateTtlDays,
    });
  });
}
