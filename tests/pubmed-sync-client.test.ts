import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

import {
  pubmedEsearch,
  pubmedEsearchAll,
  resolveOpenAccessByDoi,
} from "../src/lib/pubmed-sync-client";

const server = setupServer();

let originalUnpaywallEmail: string | undefined;
let originalNcbiEmail: string | undefined;

before(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  originalUnpaywallEmail = process.env.UNPAYWALL_EMAIL;
  originalNcbiEmail = process.env.NCBI_EMAIL;
});

afterEach(() => {
  server.resetHandlers();
  if (originalUnpaywallEmail == null) {
    delete process.env.UNPAYWALL_EMAIL;
  } else {
    process.env.UNPAYWALL_EMAIL = originalUnpaywallEmail;
  }
  if (originalNcbiEmail == null) {
    delete process.env.NCBI_EMAIL;
  } else {
    process.env.NCBI_EMAIL = originalNcbiEmail;
  }
});

after(() => {
  server.close();
});

test("pubmedEsearch throws when NCBI returns a retryable non-OK response", async () => {
  server.use(
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", () =>
      new HttpResponse(null, { status: 429 }),
    ),
  );

  await assert.rejects(
    () => pubmedEsearch("artificial intelligence", 10),
    /PubMed esearch returned HTTP 429/,
  );
});

test("pubmedEsearchAll honors the time-budget stop hook between pages", async () => {
  let calls = 0;
  server.use(
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", () => {
      calls += 1;
      return HttpResponse.json({
        esearchresult: {
          count: "3",
          idlist: [String(calls)],
        },
      });
    }),
  );

  const result = await pubmedEsearchAll({
    term: "artificial intelligence",
    pageSize: 1,
    maxPages: 3,
    maxRecords: 3,
    shouldStop: () => calls > 0,
  });

  assert.equal(calls, 1);
  assert.equal(result.stoppedEarly, true);
  assert.deepEqual(result.ids, ["1"]);
});

test("resolveOpenAccessByDoi marks failed Unpaywall lookups as unresolved", async () => {
  process.env.UNPAYWALL_EMAIL = "research@example.com";
  delete process.env.NCBI_EMAIL;
  server.use(
    http.get("https://api.unpaywall.org/v2/:doi", () =>
      new HttpResponse(null, { status: 503 }),
    ),
  );

  const result = await resolveOpenAccessByDoi("10.1000/example");

  assert.deepEqual(result, {
    resolved: false,
    is_open_access: false,
    oa_pdf_url: null,
  });
});
