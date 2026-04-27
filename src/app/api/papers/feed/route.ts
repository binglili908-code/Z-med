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
} from "@/server/repositories/papers";
import {
  findProfileIdByContactEmail,
  getProfileSubscriptionStatus,
  type ProfileSubscriptionStatus,
} from "@/server/repositories/profiles";
import type { FeedResponse } from "@/shared/contracts/papers";
import { validateFeedResponse } from "@/shared/contracts/papers.schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptySubscriptionStatus: ProfileSubscriptionStatus = {
  subscriptionEnabled: false,
  hasSubscriptionConfig: false,
  keywords: [],
  customJournals: [],
  matchingKeywords: [],
  matchingJournals: [],
  normalizedAt: null,
  normalizationError: null,
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

async function resolveBypassUserId(service: ReturnType<typeof createServiceSupabaseClient>) {
  const direct = getDevBypassUserId();
  if (direct) return direct;

  const seedEmail = getDevBypassSeedEmail();
  if (!seedEmail) return null;

  return findProfileIdByContactEmail(service, seedEmail);
}

async function loadPersonalizedFeed(args: {
  service: ReturnType<typeof createServiceSupabaseClient>;
  userId: string;
  page: number;
  pageSize: number;
  subscriptionStatus: ProfileSubscriptionStatus;
}) {
  const mode = getPersonalizedFeedMode();
  const rpcFeedPromise = () =>
    getPersonalizedFeed(args.service, {
      userId: args.userId,
      page: args.page,
      pageSize: args.pageSize,
    });

  if (mode === "app") {
    try {
      return await getPersonalizedFeedInApp({
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
      const appFeed = await getPersonalizedFeedInApp({
        userId: args.userId,
        page: args.page,
        pageSize: args.pageSize,
        subscriptionStatus: args.subscriptionStatus,
      });
      logPersonalizedFeedComparison({
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = clamp(Number(searchParams.get("page") ?? 1) || 1, 1, 1000);
  const pageSize = clamp(Number(searchParams.get("pageSize") ?? 12) || 12, 1, 50);
  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;
  const token = getBearerToken(req);
  const service = createServiceSupabaseClient();
  const devBypassAuth = isDevBypassAuthEnabled();

  try {
    let userId: string | null = null;
    if (token) {
      const userClient = createUserSupabaseClient(token);
      const {
        data: { user },
      } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    }

    if (!userId && devBypassAuth) {
      userId = await resolveBypassUserId(service);
    }

    const subscriptionStatus = userId
      ? await getProfileSubscriptionStatus(service, userId)
      : emptySubscriptionStatus;

    if (userId && subscriptionStatus.hasSubscriptionConfig) {
      const feed = await loadPersonalizedFeed({
        service,
        userId,
        page,
        pageSize,
        subscriptionStatus,
      });
      const interactions = await getPaperEmailInteractions(
        service,
        userId,
        feed.paperRows.map((paper) => paper.id),
      );

      const response = validateFeedResponse({
        papers: feed.paperRows.map((paper) => mapPaperToFeedPaper(paper, interactions)),
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
        devBypassSeedEmail: devBypassAuth ? getDevBypassSeedEmail() : null,
      } satisfies FeedResponse);
      return NextResponse.json(response);
    }

    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { paperRows, total } = await listFallbackFeedPapers(service, {
      cutoffDate,
      fromIndex,
      toIndex,
    });
    const interactions = await getPaperEmailInteractions(
      service,
      userId,
      paperRows.map((paper) => paper.id),
    );

    const response = validateFeedResponse({
      papers: paperRows.map((paper) => mapPaperToFeedPaper(paper, interactions)),
      total,
      page,
      pageSize,
      personalized: false,
      hasSubscription: subscriptionStatus.hasSubscriptionConfig,
      requiresLogin: !userId && !devBypassAuth,
      devBypassAuth,
      devBypassUserId: devBypassAuth ? userId : null,
      devBypassSeedEmail: devBypassAuth ? getDevBypassSeedEmail() : null,
    } satisfies FeedResponse);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Feed error:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
