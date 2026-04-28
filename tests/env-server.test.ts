import assert from "node:assert/strict";
import test from "node:test";

import { EnvValidationError, validateServerEnv } from "../src/lib/env/server";

function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    RESEND_API_KEY: "resend-key",
    RESEND_FROM_EMAIL: "Z-Lab <noreply@zlab-med.com>",
    CRON_SECRET: "cron-secret",
    MINIMAX_API_KEY: "minimax-key",
    MINIMAX_MODEL: "MiniMax-M2.7",
    MINIMAX_API_BASE_URL: "https://api.minimaxi.com",
    UNPAYWALL_EMAIL: "research@example.com",
    NCBI_EMAIL: "research@example.com",
    NCBI_API_KEY: "ncbi-key",
    PERSONALIZED_FEED_MODE: "app",
    PUBMED_QUERY_ASSIST_ENABLED: "true",
    ...overrides,
    NODE_ENV:
      overrides.NODE_ENV === "development" ||
      overrides.NODE_ENV === "production" ||
      overrides.NODE_ENV === "test"
        ? overrides.NODE_ENV
        : "test",
  };
}

function getValidationIssues(env: NodeJS.ProcessEnv) {
  try {
    validateServerEnv(env);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.issues;
  }
  assert.fail("Expected env validation to fail");
}

test("requires either Supabase publishable key or anon key", () => {
  const issues = getValidationIssues(
    validEnv({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    }),
  );

  assert.ok(
    issues.some((issue) =>
      issue.message.includes(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ),
    ),
  );
});

test("rejects invalid URL values", () => {
  const issues = getValidationIssues(
    validEnv({
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
    }),
  );

  assert.ok(
    issues.some(
      (issue) =>
        issue.name === "NEXT_PUBLIC_SUPABASE_URL" &&
        issue.message.includes("valid URL"),
    ),
  );
});

test("rejects invalid personalized feed mode", () => {
  const issues = getValidationIssues(
    validEnv({
      PERSONALIZED_FEED_MODE: "magic",
    }),
  );

  assert.ok(
    issues.some(
      (issue) =>
        issue.name === "PERSONALIZED_FEED_MODE" &&
        issue.message.includes("rpc, app, compare"),
    ),
  );
});

test("rejects Resend testing sender domain", () => {
  const issues = getValidationIssues(
    validEnv({
      RESEND_FROM_EMAIL: "onboarding@resend.dev",
    }),
  );

  assert.ok(
    issues.some(
      (issue) =>
        issue.name === "RESEND_FROM_EMAIL" &&
        issue.message.includes("verified sending domain"),
    ),
  );
});
