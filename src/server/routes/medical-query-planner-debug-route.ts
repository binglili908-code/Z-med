import { NextResponse } from "next/server";

import { authorizeDeveloperRequest } from "@/lib/dev-admin-auth";
import { planMedicalQuery } from "@/lib/medical-query-planner";
import type { MedicalQueryPlan } from "@/lib/medical-query-plan";
import {
  normalizeSubscriptionPreferences,
  type NormalizedSubscriptionPreferences,
} from "@/lib/subscription-preference-normalizer";

type AuthorizedDeveloperActor = {
  mode: "email" | "dev-bypass";
  userId: string | null;
  email: string | null;
};

type DeveloperAuthorizationResult =
  | {
      authorized: true;
      actor: AuthorizedDeveloperActor;
    }
  | {
      authorized: false;
      response: NextResponse;
    };

export type MedicalQueryPlannerDebugRouteDependencies = {
  authorizeDeveloperRequest: (req: Request) => Promise<DeveloperAuthorizationResult>;
  normalizeSubscriptionPreferences: typeof normalizeSubscriptionPreferences;
  planMedicalQuery: typeof planMedicalQuery;
};

const defaultDependencies: MedicalQueryPlannerDebugRouteDependencies = {
  authorizeDeveloperRequest,
  normalizeSubscriptionPreferences,
  planMedicalQuery,
};

function normalizeStringList(value: unknown, maxItems: number) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 120) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }

  return out;
}

async function parseBody(req: Request) {
  return (await req.json().catch(() => null)) as
    | {
        input?: unknown;
        keywords?: unknown;
        customJournals?: unknown;
      }
    | null;
}

function plannerInputFrom(args: {
  keywords: string[];
  normalized: NormalizedSubscriptionPreferences;
}) {
  return args.keywords.length ? args.keywords : args.normalized.keywords.slice(0, 20);
}

export function createMedicalQueryPlannerDebugRouteHandler(
  deps: MedicalQueryPlannerDebugRouteDependencies = defaultDependencies,
) {
  return async function handleMedicalQueryPlannerDebug(req: Request) {
    const auth = await deps.authorizeDeveloperRequest(req);
    if (!auth.authorized) return auth.response;

    const body = await parseBody(req);
    const keywords = normalizeStringList(body?.keywords ?? body?.input, 20);
    const customJournals = normalizeStringList(body?.customJournals, 20);

    if (!keywords.length && !customJournals.length) {
      return NextResponse.json(
        {
          error: "Provide input, keywords, or customJournals",
        },
        { status: 400 },
      );
    }

    const normalized = await deps.normalizeSubscriptionPreferences(
      {
        keywords,
        customJournals,
      },
      {
        medicalQueryPlannerEnabled: false,
      },
    );
    const plannerInput = plannerInputFrom({ keywords, normalized });
    let plan: MedicalQueryPlan | null = null;
    let plannerError: string | null = null;

    if (plannerInput.length) {
      try {
        plan = await deps.planMedicalQuery(plannerInput);
      } catch (error) {
        plannerError =
          error instanceof Error ? error.message : "Unknown medical query planner error";
      }
    }

    return NextResponse.json({
      ok: true,
      actor: auth.actor,
      input: {
        keywords,
        customJournals,
        plannerInput,
      },
      legacy_normalizer: normalized,
      dynamic_planner: {
        plan,
        error: plannerError,
      },
      behavior: {
        changesRecommendationBehavior: false,
        note:
          "This developer endpoint compares outputs only. It does not write to Supabase or alter recommendation matching.",
      },
    });
  };
}
