import {
  runKeywordSyncJob,
  type KeywordSyncJobOptions,
} from "@/lib/pubmed-sync";
import { runCronRoute } from "@/server/cron/run-cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parsePositiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseKeywordList(searchParams: URLSearchParams) {
  const values = [
    ...searchParams.getAll("keyword"),
    ...searchParams.getAll("keywords").flatMap((value) => value.split(",")),
  ];

  return Array.from(
    new Set(
      values
        .map((value) => value.normalize("NFKC").replace(/\s+/g, " ").trim())
        .filter((value) => value.length > 0 && value.length <= 120),
    ),
  );
}

function parseWindows(value: string | null) {
  if (!value) return undefined;
  const windows = value
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item));
  return windows.length ? windows : undefined;
}

function parseBoolean(value: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseOptionalBoolean(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return undefined;
}

function parseKeywordSyncOptions(req: Request): KeywordSyncJobOptions {
  const { searchParams } = new URL(req.url);
  const keywords = parseKeywordList(searchParams);
  return {
    keywords: keywords.length ? keywords : undefined,
    keywordLimit: parsePositiveInteger(searchParams.get("limit")),
    windows: parseWindows(searchParams.get("windows")),
    maxNewPmids:
      parsePositiveInteger(searchParams.get("maxNew")) ??
      parsePositiveInteger(searchParams.get("maxNewPmids")),
    includeExisting:
      parseBoolean(searchParams.get("includeExisting")) ||
      parseBoolean(searchParams.get("refreshExisting")),
    includeDiagnostics:
      parseBoolean(searchParams.get("diagnostics")) ||
      parseBoolean(searchParams.get("debug")),
    includeAbstracts: parseOptionalBoolean(searchParams.get("includeAbstracts")),
    resolveOpenAccess:
      parseOptionalBoolean(searchParams.get("resolveOpenAccess")) ??
      parseOptionalBoolean(searchParams.get("openAccess")) ??
      parseOptionalBoolean(searchParams.get("oa")),
    timeBudgetMs:
      parsePositiveInteger(searchParams.get("timeBudgetMs")) ??
      parsePositiveInteger(searchParams.get("budgetMs")),
  };
}

export async function GET(req: Request) {
  const options = parseKeywordSyncOptions(req);
  return runCronRoute(req, () => runKeywordSyncJob(options), { successKey: "success" });
}
