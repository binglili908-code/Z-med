import {
  buildFeedProfileTerms,
  paginateRankedFeed,
  rankPersonalizedFeedPapers,
  rankTopicFallbackFeedPapers,
} from "@/lib/personalized-feed-ranking";
import { filterReviewLikePapers } from "@/lib/paper-article-type";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  listPersonalizedFeedCandidatePapers,
  type PersonalizedFeedResult,
} from "@/server/repositories/papers";
import {
  getProfileSubscriptionStatus,
  type ProfileSubscriptionStatus,
} from "@/server/repositories/profiles";

const DEFAULT_CANDIDATE_LIMIT = 400;
const TOPIC_FALLBACK_MESSAGE =
  "\u672c\u5468\u6682\u672a\u627e\u5230\u540c\u65f6\u5339\u914d\u8ba2\u9605\u671f\u520a\u548c\u5173\u952e\u8bcd\u7684\u6587\u732e\u3002\u4ee5\u4e0b\u662f\u4e0e\u60a8\u7684\u7814\u7a76\u65b9\u5411\u5f3a\u76f8\u5173\u7684\u9ad8\u8d28\u91cf\u6587\u732e\u3002";

function recentCutoffDate(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getPersonalizedFeedMode() {
  const mode = process.env.PERSONALIZED_FEED_MODE;
  if (mode === "app" || mode === "compare") return mode;
  return "app";
}

export async function getPersonalizedFeedInApp(args: {
  userId: string;
  page: number;
  pageSize: number;
  candidateLimit?: number;
  subscriptionStatus?: ProfileSubscriptionStatus;
}): Promise<PersonalizedFeedResult> {
  const supabase = createServiceSupabaseClient();
  const status =
    args.subscriptionStatus ?? (await getProfileSubscriptionStatus(supabase, args.userId));
  const terms = buildFeedProfileTerms(status);
  const candidates = await listPersonalizedFeedCandidatePapers(supabase, {
    cutoffDate: recentCutoffDate(30),
    limit: args.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
  });
  const filteredCandidates = filterReviewLikePapers(candidates, status.excludeReviews);
  const exactRanked = rankPersonalizedFeedPapers(filteredCandidates, terms);
  if (exactRanked.length) {
    return paginateRankedFeed(exactRanked, args.page, args.pageSize, {
      exactMatchTotal: exactRanked.length,
      strictMatchFallback: false,
      strictMatchMessage: null,
      fallbackType: null,
    });
  }

  if (terms.keywords.length && terms.journals.length) {
    const topicFallback = rankTopicFallbackFeedPapers(filteredCandidates, terms);
    if (topicFallback.length) {
      return paginateRankedFeed(topicFallback, args.page, args.pageSize, {
        exactMatchTotal: 0,
        strictMatchFallback: true,
        strictMatchMessage: TOPIC_FALLBACK_MESSAGE,
        fallbackType: "topic",
      });
    }
  }

  return paginateRankedFeed(exactRanked, args.page, args.pageSize, {
    exactMatchTotal: 0,
    strictMatchFallback: false,
    strictMatchMessage: null,
    fallbackType: null,
  });
}

export function logPersonalizedFeedComparison(args: {
  userId: string;
  matchingKeywords: string[];
  matchingJournals: string[];
  rpc: PersonalizedFeedResult;
  app: PersonalizedFeedResult;
}) {
  const rpcIds = args.rpc.paperRows.map((paper) => paper.id);
  const appIds = args.app.paperRows.map((paper) => paper.id);
  const rpcSet = new Set(rpcIds);
  const appSet = new Set(appIds);
  const overlap = appIds.filter((id) => rpcSet.has(id));
  const appOnly = appIds.filter((id) => !rpcSet.has(id));
  const rpcOnly = rpcIds.filter((id) => !appSet.has(id));

  console.info(
    "[personalized-feed-compare]",
    JSON.stringify({
      userId: args.userId,
      rpcTotal: args.rpc.total,
      appTotal: args.app.total,
      appExactMatchTotal: args.app.exactMatchTotal ?? null,
      appStrictMatchFallback: args.app.strictMatchFallback ?? false,
      appFallbackType: args.app.fallbackType ?? null,
      page: args.rpc.page,
      pageSize: args.rpc.pageSize,
      matchingKeywords: args.matchingKeywords,
      matchingJournals: args.matchingJournals,
      overlapCount: overlap.length,
      appOnly,
      rpcOnly,
    }),
  );
}
