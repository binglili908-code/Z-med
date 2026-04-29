import { runPubmedSyncJob } from "@/lib/pubmed-sync";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runCronRoute(req, () => runPubmedSyncJob());
}
