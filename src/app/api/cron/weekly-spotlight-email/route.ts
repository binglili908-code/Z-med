import { NextResponse } from "next/server";

import { authorizeDeveloperRequest } from "@/lib/dev-admin-auth";
import { isDevBypassAuthEnabled } from "@/lib/supabase/env";
import { runWeeklySpotlightEmailJob } from "@/lib/weekly-spotlight-email";

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

function toBoolean(value: string | null) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function toOptionalNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function parseGetOptions(req: Request): ManualJobOptions {
  const { searchParams } = new URL(req.url);
  return {
    userId: searchParams.get("userId") ?? undefined,
    email: searchParams.get("email") ?? undefined,
    issueWeekStart: searchParams.get("issueWeekStart") ?? undefined,
    limit: toOptionalNumber(searchParams.get("limit")),
    dryRun: toBoolean(searchParams.get("dryRun")),
    retryFailed: toBoolean(searchParams.get("retryFailed")),
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

  if (limit != null && !Number.isFinite(limit)) {
    throw new Error("Invalid limit");
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
  const auth = await authorizeDeveloperRequest(req);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const options = parseGetOptions(req);
    const result = await executeJob(options, hasManualOverride(options) ? "manual" : "cron");
    return NextResponse.json({
      ok: true,
      actor: auth.actor,
      devBypassAuth: isDevBypassAuthEnabled(),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await authorizeDeveloperRequest(req);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await executeJob(normalizePostBody(body), "manual");
    return NextResponse.json({
      ok: true,
      actor: auth.actor,
      devBypassAuth: isDevBypassAuthEnabled(),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
