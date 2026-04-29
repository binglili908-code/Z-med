import { NextResponse } from "next/server";

import {
  getPersonalizedFeedInApp,
  getPersonalizedFeedMode,
  logPersonalizedFeedComparison,
} from "@/lib/personalized-feed";
import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";
import {
  getPaperEmailInteractions,
  getPersonalizedFeed,
  listFallbackFeedPapers,
  mapPaperToFeedPaper,
  type PersonalizedFeedResult,
} from "@/server/repositories/papers";
import {
  findProfileIdByContactEmail,
  getProfileSubscriptionStatus,
  type ProfileSubscriptionStatus,
} from "@/server/repositories/profiles";
import type { FeedResponse } from "@/shared/contracts/papers";
import { validateFeedResponse } from "@/shared/contracts/papers.schema";

const emptySubscriptionStatus: ProfileSubscriptionStatus = {
  subscriptionEnabled: false,
  hasSubscriptionConfig: false,
  excludeReviews: false,
  keywords: [],
  customJournals: [],
  matchingKeywords: [],
  matchingJournals: [],
  normalizedAt: null,
  normalizationError: null,
};

type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;
type UserSupabaseClient = ReturnType<typeof createUserSupabaseClient>;

export type FeedRouteDependencies = {
  createServiceSupabaseClient: () => ServiceSupabaseClient;
  createUserSupabaseClient: (accessToken?: string) => UserSupabaseClient;
  isDevBypassAuthEnabled: () => boolean;
  getDevBypassUserId: () => string | null;
  getDevBypassSeedEmail: () => string | null;
  findProfileIdByContactEmail: typeof findProfileIdByContactEmail;
  getProfileSubscriptionStatus: typeof getProfileSubscriptionStatus;
  getPersonalizedFeedMode: typeof getPersonalizedFeedMode;
  getPersonalizedFeed: typeof getPersonalizedFeed;
  getPersonalizedFeedInApp: typeof getPersonalizedFeedInApp;
  logPersonalizedFeedComparison: typeof logPersonalizedFeedComparison;
  listFallbackFeedPapers: typeof listFallbackFeedPapers;
  getPaperEmailInteractions: typeof getPaperEmailInteractions;
  mapPaperToFeedPaper: typeof mapPaperToFeedPaper;
  now: () => Date;
};

const defaultDependencies: FeedRouteDependencies = {
  createServiceSupabaseClient,
  createUserSupabaseClient,
  isDevBypassAuthEnabled,
  getDevBypassUserId,
  getDevBypassSeedEmail,
  findProfileIdByContactEmail,
  getProfileSubscriptionStatus,
  getPersonalizedFeedMode,
  getPersonalizedFeed,
  getPersonalizedFeedInApp,
  logPersonalizedFeedComparison,
  listFallbackFeedPapers,
  getPaperEmailInteractions,
  mapPaperToFeedPaper,
  now: () => new Date(),
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Failed to fetch feed";
}

async function resolveBypassUserId(
  deps: FeedRouteDependencies,
  service: ServiceSupabaseClient,
) {
  const direct = deps.getDevBypassUserId();
  if (direct) return direct;

  const seedEmail = deps.getDevBypassSeedEmail();
  if (!seedEmail) return null;

  return deps.findProfileIdByContactEmail(service, seedEmail);
}

async function loadPersonalizedFeed(args: {
  deps: FeedRouteDependencies;
  service: ServiceSupabaseClient;
  userId: string;
  page: number;
  pageSize: number;
  subscriptionStatus: ProfileSubscriptionStatus;
}): Promise<PersonalizedFeedResult> {
  const mode = args.deps.getPersonalizedFeedMode();
  const rpcFeedPromise = () =>
    args.deps.getPersonalizedFeed(args.service, {
      userId: args.userId,
      page: args.page,
      pageSize: args.pageSize,
    });

  if (mode === "app") {
    try {
      return await args.deps.getPersonalizedFeedInApp({
        userId: args.userId,
        page: args.page,
        pageSize: args.pageSize,
        subscriptionStatus: args.subscriptionStatus,
      });
    } catch (error) {
      console.error("[personalized-feed-app-fallback]", error);
      return rpcFeedPromise();
    }
  }

  const rpcFeed = await rpcFeedPromise();
  if (mode === "compare") {
    try {
      const appFeed = await args.deps.getPersonalizedFeedInApp({
        userId: args.userId,
        page: args.page,
        pageSize: args.pageSize,
        subscriptionStatus: args.subscriptionStatus,
      });
      args.deps.logPersonalizedFeedComparison({
        userId: args.userId,
        matchingKeywords: args.subscriptionStatus.matchingKeywords,
        matchingJournals: args.subscriptionStatus.matchingJournals,
        rpc: rpcFeed,
        app: appFeed,
      });
    } catch (error) {
      console.error("[personalized-feed-compare-failed]", error);
    }
  }

  return rpcFeed;
}

export function createFeedRouteHandler(deps: FeedRouteDependencies = defaultDependencies) {
  return async function handleFeedRequest(req: Request) {
    const { searchParams } = new URL(req.url);
    const page = clamp(Number(searchParams.get("page") ?? 1) || 1, 1, 1000);
    const pageSize = clamp(Number(searchParams.get("pageSize") ?? 12) || 12, 1, 50);
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;
    const token = getBearerToken(req);
    const service = deps.createServiceSupabaseClient();
    const devBypassAuth = deps.isDevBypassAuthEnabled();

    try {
      let userId: string | null = null;
      if (token) {
        const userClient = deps.createUserSupabaseClient(token);
        const {
          data: { user },
        } = await userClient.auth.getUser();
        userId = user?.id ?? null;
      }

      if (!userId && devBypassAuth) {
        userId = await resolveBypassUserId(deps, service);
      }

      const subscriptionStatus = userId
        ? await deps.getProfileSubscriptionStatus(service, userId)
        : emptySubscriptionStatus;

      if (userId && subscriptionStatus.hasSubscriptionConfig) {
        const feed = await loadPersonalizedFeed({
          deps,
          service,
          userId,
          page,
          pageSize,
          subscriptionStatus,
        });
        const interactions = await deps.getPaperEmailInteractions(
          service,
          userId,
          feed.paperRows.map((paper) => paper.id),
        );

        const response = validateFeedResponse({
          papers: feed.paperRows.map((paper) => deps.mapPaperToFeedPaper(paper, interactions)),
          total: feed.total,
          page: feed.page,
          pageSize: feed.pageSize,
          personalized: true,
          hasSubscription: true,
          requiresLogin: false,
          exactMatchTotal: feed.exactMatchTotal,
          strictMatchFallback: feed.strictMatchFallback,
          strictMatchMessage: feed.strictMatchMessage,
          fallbackType: feed.fallbackType,
          devBypassAuth,
          devBypassUserId: devBypassAuth ? userId : null,
          devBypassSeedEmail: devBypassAuth ? deps.getDevBypassSeedEmail() : null,
        } satisfies FeedResponse);
        return NextResponse.json(response);
      }

      const cutoffDate = new Date(deps.now().getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const { paperRows, total } = await deps.listFallbackFeedPapers(service, {
        cutoffDate,
        fromIndex,
        toIndex,
      });
      const interactions = await deps.getPaperEmailInteractions(
        service,
        userId,
        paperRows.map((paper) => paper.id),
      );

      const response = validateFeedResponse({
        papers: paperRows.map((paper) => deps.mapPaperToFeedPaper(paper, interactions)),
        total,
        page,
        pageSize,
        personalized: false,
        hasSubscription: subscriptionStatus.hasSubscriptionConfig,
        requiresLogin: !userId && !devBypassAuth,
        devBypassAuth,
        devBypassUserId: devBypassAuth ? userId : null,
        devBypassSeedEmail: devBypassAuth ? deps.getDevBypassSeedEmail() : null,
      } satisfies FeedResponse);
      return NextResponse.json(response);
    } catch (error) {
      console.error("Feed error:", error);
      return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
  };
}
