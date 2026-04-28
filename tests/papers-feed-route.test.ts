import assert from "node:assert/strict";
import test from "node:test";

import {
  createFeedRouteHandler,
  type FeedRouteDependencies,
} from "../src/server/routes/papers-feed-route";
import type { FeedPaper } from "../src/shared/contracts/papers";

function makeFeedPaper(id: string): FeedPaper {
  return {
    id,
    title: `Paper ${id}`,
    title_zh: null,
    journal: "Nature",
    journal_if: 64.8,
    journal_jcr: "Q1",
    journal_cas_zone: "1区",
    publication_date: "2026-04-27",
    quality_score: 95,
    quality_tier: "top",
    pubmed_url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    is_open_access: true,
    oa_pdf_url: null,
    abstract: "Abstract",
    abstract_zh: null,
    ai_analysis: null,
    source_type: "precision",
    recommendation_reason: null,
    pdf_emailed_at: null,
    topics: [],
    recommendation_score: 95,
  };
}

function makeDeps(overrides: Partial<FeedRouteDependencies> = {}): FeedRouteDependencies {
  const service = {};
  const deps = {
    createServiceSupabaseClient: () => service,
    createUserSupabaseClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    }),
    isDevBypassAuthEnabled: () => false,
    getDevBypassUserId: () => null,
    getDevBypassSeedEmail: () => null,
    findProfileIdByContactEmail: async () => null,
    getProfileSubscriptionStatus: async () => ({
      subscriptionEnabled: false,
      hasSubscriptionConfig: false,
      keywords: [],
      customJournals: [],
      matchingKeywords: [],
      matchingJournals: [],
      normalizedAt: null,
      normalizationError: null,
    }),
    getPersonalizedFeedMode: () => "app",
    getPersonalizedFeed: async () => ({
      paperRows: [],
      total: 0,
      page: 1,
      pageSize: 12,
    }),
    getPersonalizedFeedInApp: async () => ({
      paperRows: [],
      total: 0,
      page: 1,
      pageSize: 12,
    }),
    logPersonalizedFeedComparison: () => undefined,
    listFallbackFeedPapers: async () => ({
      paperRows: [],
      total: 0,
    }),
    getPaperEmailInteractions: async () => new Map(),
    mapPaperToFeedPaper: (paper: { id: string }) => makeFeedPaper(paper.id),
    now: () => new Date("2026-04-27T00:00:00.000Z"),
  };

  return {
    ...(deps as unknown as FeedRouteDependencies),
    ...overrides,
  };
}

test("feed route returns fallback papers for anonymous users", async () => {
  let fallbackParams:
    | { cutoffDate: string; fromIndex: number; toIndex: number }
    | null = null;
  let interactionArgs: { userId: string | null; paperIds: string[] } | null = null;
  const handler = createFeedRouteHandler(
    makeDeps({
      listFallbackFeedPapers: async (_service, params) => {
        fallbackParams = params;
        return {
          paperRows: [{ id: "fallback-1" }] as never[],
          total: 5,
        };
      },
      getPaperEmailInteractions: async (_service, userId, paperIds) => {
        interactionArgs = { userId, paperIds };
        return new Map();
      },
    }),
  );

  const res = await handler(
    new Request("https://example.test/api/papers/feed?page=2&pageSize=3"),
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(fallbackParams, {
    cutoffDate: "2026-03-28",
    fromIndex: 3,
    toIndex: 5,
  });
  assert.deepEqual(interactionArgs, {
    userId: null,
    paperIds: ["fallback-1"],
  });
  assert.equal(body.personalized, false);
  assert.equal(body.hasSubscription, false);
  assert.equal(body.requiresLogin, true);
  assert.equal(body.total, 5);
  assert.equal(body.page, 2);
  assert.equal(body.pageSize, 3);
  assert.equal(body.papers[0].id, "fallback-1");
});

test("feed route returns personalized papers for subscribed users", async () => {
  let receivedToken: string | null = null;
  let personalizedArgs:
    | { userId: string; page: number; pageSize: number; matchingKeywords: string[] }
    | null = null;
  const handler = createFeedRouteHandler(
    makeDeps({
      createUserSupabaseClient: (token?: string) => {
        receivedToken = token ?? null;
        return {
          auth: {
            getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
          },
        } as never;
      },
      getProfileSubscriptionStatus: async (_service, userId) => {
        assert.equal(userId, "user-1");
        return {
          subscriptionEnabled: true,
          hasSubscriptionConfig: true,
          keywords: ["pancreatic cancer"],
          customJournals: ["Nature"],
          matchingKeywords: ["pancreatic neoplasms"],
          matchingJournals: ["Nature"],
          normalizedAt: "2026-04-27T00:00:00.000Z",
          normalizationError: null,
        };
      },
      getPersonalizedFeedInApp: async (args) => {
        assert.ok(args.subscriptionStatus);
        personalizedArgs = {
          userId: args.userId,
          page: args.page,
          pageSize: args.pageSize,
          matchingKeywords: args.subscriptionStatus.matchingKeywords,
        };
        return {
          paperRows: [{ id: "personalized-1" }] as never[],
          total: 1,
          page: args.page,
          pageSize: args.pageSize,
          exactMatchTotal: 1,
          strictMatchFallback: false,
          strictMatchMessage: null,
          fallbackType: null,
        };
      },
      getPaperEmailInteractions: async (_service, userId, paperIds) => {
        assert.equal(userId, "user-1");
        assert.deepEqual(paperIds, ["personalized-1"]);
        return new Map();
      },
    }),
  );

  const res = await handler(
    new Request("https://example.test/api/papers/feed?page=1&pageSize=12", {
      headers: {
        Authorization: "Bearer user-token",
      },
    }),
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(receivedToken, "user-token");
  assert.deepEqual(personalizedArgs, {
    userId: "user-1",
    page: 1,
    pageSize: 12,
    matchingKeywords: ["pancreatic neoplasms"],
  });
  assert.equal(body.personalized, true);
  assert.equal(body.hasSubscription, true);
  assert.equal(body.requiresLogin, false);
  assert.equal(body.exactMatchTotal, 1);
  assert.equal(body.papers[0].id, "personalized-1");
});
