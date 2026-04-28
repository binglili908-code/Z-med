import { z } from "zod";

export type EnvValidationIssue = {
  name: string;
  message: string;
};

export class EnvValidationError extends Error {
  issues: EnvValidationIssue[];

  constructor(issues: EnvValidationIssue[]) {
    super("Environment validation failed");
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

const RESEND_TESTING_DOMAIN_PATTERN = /@resend\.dev\b/i;

function trimValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

function emptyToUndefined(value: unknown) {
  const trimmed = trimValue(value);
  return trimmed === "" ? undefined : trimmed;
}

function requiredString(name: string) {
  return z.preprocess(
    (value) => {
      const trimmed = trimValue(value);
      return typeof trimmed === "string" ? trimmed : "";
    },
    z.string().min(1, `${name} is required`),
  );
}

function optionalString() {
  return z.preprocess(emptyToUndefined, z.string().optional());
}

function requiredUrl(name: string) {
  return requiredString(name).pipe(
    z.string().url(`${name} must be a valid URL`),
  );
}

function requiredEmail(name: string) {
  return requiredString(name).refine(
    (value) => Boolean(extractEmailAddress(value)),
    `${name} must be a valid email address`,
  );
}

function requiredEnum<T extends [string, ...string[]]>(name: string, values: T) {
  return requiredString(name).pipe(
    z.enum(values, {
      message: `${name} must be one of: ${values.join(", ")}`,
    }),
  );
}

function optionalEnum<T extends [string, ...string[]]>(name: string, values: T) {
  return z.preprocess(
    emptyToUndefined,
    z
      .enum(values, {
        message: `${name} must be one of: ${values.join(", ")}`,
      })
      .optional(),
  );
}

function extractEmailAddress(value: string) {
  const trimmed = value.trim();
  const displayNameMatch = trimmed.match(/<([^<>]+)>$/);
  const email = (displayNameMatch?.[1] ?? trimmed).trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

export const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: requiredUrl("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString(),
    SUPABASE_SERVICE_ROLE_KEY: requiredString("SUPABASE_SERVICE_ROLE_KEY"),
    RESEND_API_KEY: requiredString("RESEND_API_KEY"),
    RESEND_FROM_EMAIL: requiredEmail("RESEND_FROM_EMAIL").refine(
      (value) => {
        const email = extractEmailAddress(value);
        return Boolean(email && !RESEND_TESTING_DOMAIN_PATTERN.test(email));
      },
      "RESEND_FROM_EMAIL must use a verified sending domain, not resend.dev",
    ),
    CRON_SECRET: requiredString("CRON_SECRET"),
    MINIMAX_API_KEY: requiredString("MINIMAX_API_KEY"),
    MINIMAX_MODEL: requiredString("MINIMAX_MODEL"),
    MINIMAX_API_BASE_URL: requiredUrl("MINIMAX_API_BASE_URL"),
    UNPAYWALL_EMAIL: requiredEmail("UNPAYWALL_EMAIL"),
    NCBI_EMAIL: requiredEmail("NCBI_EMAIL"),
    NCBI_API_KEY: requiredString("NCBI_API_KEY"),
    PERSONALIZED_FEED_MODE: requiredEnum("PERSONALIZED_FEED_MODE", [
      "rpc",
      "app",
      "compare",
    ]),
    PUBMED_QUERY_ASSIST_ENABLED: requiredEnum("PUBMED_QUERY_ASSIST_ENABLED", [
      "true",
      "false",
    ]),
    MEDICAL_QUERY_PLANNER_ENABLED: optionalEnum("MEDICAL_QUERY_PLANNER_ENABLED", [
      "true",
      "false",
    ]),
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
        message:
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is required",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function validateServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(env);
  if (result.success) return result.data;

  throw new EnvValidationError(
    result.error.issues.map((issue) => ({
      name: issue.path.join(".") || "ENV",
      message: issue.message,
    })),
  );
}
