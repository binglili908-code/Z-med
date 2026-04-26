import { runWeeklyPushJob } from "@/lib/weekly-push";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runCronRoute(req, () => runWeeklyPushJob());
}
