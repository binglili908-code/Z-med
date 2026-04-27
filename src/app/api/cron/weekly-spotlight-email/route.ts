import { runWeeklySpotlightEmailJob } from "@/lib/weekly-spotlight-email";
import {
  parseCronBooleanParam,
  parseOptionalCronIntegerParam,
} from "@/server/cron/parse-cron-params";
import { CronRouteError, runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualJobOptions = {
  userId?: string;
  email?: string;
  issueWeekStart?: string;
  limit?: number;
  dryRun?: boolean;
  retryFailed?: boolean;
};

function parseGetOptions(req: Request): ManualJobOptions {
  const { searchParams } = new URL(req.url);
  return {
    userId: searchParams.get("userId") ?? undefined,
    email: searchParams.get("email") ?? undefined,
    issueWeekStart: searchParams.get("issueWeekStart") ?? undefined,
    limit: parseOptionalCronIntegerParam(req, "limit", { min: 1, max: 100 }),
    dryRun: parseCronBooleanParam(req, "dryRun"),
    retryFailed: parseCronBooleanParam(req, "retryFailed"),
  };
}

function normalizePostBody(body: unknown): ManualJobOptions {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const limit =
    typeof payload.limit === "number"
      ? payload.limit
      : typeof payload.limit === "string"
        ? Number(payload.limit)
        : undefined;

  if (limit != null && !Number.isInteger(limit)) {
    throw new CronRouteError("limit must be an integer", 400);
  }

  return {
    userId: typeof payload.userId === "string" ? payload.userId : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    issueWeekStart: typeof payload.issueWeekStart === "string" ? payload.issueWeekStart : undefined,
    limit,
    dryRun: payload.dryRun === true,
    retryFailed: payload.retryFailed === true,
  };
}

function hasManualOverride(options: ManualJobOptions) {
  return Boolean(
    options.userId ||
      options.email ||
      options.issueWeekStart ||
      options.limit != null ||
      options.dryRun ||
      options.retryFailed,
  );
}

async function executeJob(manualOptions: ManualJobOptions, triggerSource: "cron" | "manual") {
  return runWeeklySpotlightEmailJob({
    ...manualOptions,
    triggerSource,
  });
}

export async function GET(req: Request) {
  return runCronRoute(req, async () => {
    const options = parseGetOptions(req);
    const result = await executeJob(options, hasManualOverride(options) ? "manual" : "cron");
    return {
      ...result,
    };
  });
}

export async function POST(req: Request) {
  return runCronRoute(req, async () => {
    const body = await req.json().catch(() => ({}));
    const result = await executeJob(normalizePostBody(body), "manual");
    return {
      ...result,
    };
  });
}
