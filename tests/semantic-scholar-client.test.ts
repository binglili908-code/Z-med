import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

import {
  fetchSemanticScholarPaperBatch,
  fetchSemanticScholarRecommendations,
} from "../src/lib/semantic-scholar-client";

const server = setupServer();

let originalApiKey: string | undefined;

before(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  originalApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  process.env.SEMANTIC_SCHOLAR_API_KEY = "test-s2-key";
});

afterEach(() => {
  server.resetHandlers();
  if (originalApiKey == null) {
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
  } else {
    process.env.SEMANTIC_SCHOLAR_API_KEY = originalApiKey;
  }
});

after(() => {
  server.close();
});

test("fetches Semantic Scholar paper details with a server-only API key", async () => {
  server.use(
    http.post("https://api.semanticscholar.org/graph/v1/paper/batch", async ({ request }) => {
      assert.equal(request.headers.get("x-api-key"), "test-s2-key");
      const url = new URL(request.url);
      assert.ok(url.searchParams.get("fields")?.includes("citationCount"));
      assert.deepEqual(await request.json(), {
        ids: ["DOI:10.1000/example"],
      });
      return HttpResponse.json([
        {
          paperId: "s2-paper-1",
          externalIds: { DOI: "10.1000/example", PMID: "123" },
          title: "AI medicine",
          citationCount: 7,
        },
      ]);
    }),
  );

  const [paper] = await fetchSemanticScholarPaperBatch(["DOI:10.1000/example"]);

  assert.equal(paper?.paperId, "s2-paper-1");
  assert.equal(paper?.citationCount, 7);
});

test("fetches Semantic Scholar recommendations without writing papers directly", async () => {
  server.use(
    http.post("https://api.semanticscholar.org/recommendations/v1/papers", async ({ request }) => {
      assert.equal(request.headers.get("x-api-key"), "test-s2-key");
      const url = new URL(request.url);
      assert.equal(url.searchParams.get("limit"), "2");
      assert.deepEqual(await request.json(), {
        positivePaperIds: ["s2-seed"],
        negativePaperIds: [],
      });
      return HttpResponse.json({
        recommendedPapers: [
          {
            paperId: "s2-rec-1",
            title: "Candidate paper",
          },
        ],
      });
    }),
  );

  const papers = await fetchSemanticScholarRecommendations({
    positivePaperIds: ["s2-seed"],
    limit: 2,
  });

  assert.deepEqual(papers.map((paper) => paper.paperId), ["s2-rec-1"]);
});
