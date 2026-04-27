import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

import {
  assistPubmedKeywords,
  buildAssistedKeywordList,
  parseMeshSummaryJson,
  parsePubmedSpellCheckXml,
} from "../src/lib/pubmed-query-assist";

const server = setupServer();

before(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  delete process.env.PUBMED_QUERY_ASSIST_ENABLED;
});

after(() => {
  server.close();
});

test("parses PubMed spell-check XML suggestions", () => {
  const parsed = parsePubmedSpellCheckXml(
    `
    <eSpellResult>
      <Query>panceratic cancer</Query>
      <CorrectedQuery>pancreatic cancer</CorrectedQuery>
    </eSpellResult>
    `,
    "panceratic cancer",
  );

  assert.equal(parsed.original, "panceratic cancer");
  assert.equal(parsed.corrected, "pancreatic cancer");
  assert.equal(parsed.hasSuggestion, true);
});

test("parses MeSH summary JSON into heading and entry terms", () => {
  const records = parseMeshSummaryJson(
    {
      result: {
        uids: ["68010190"],
        "68010190": {
          uid: "68010190",
          ds_scopenote: "Tumors or cancer of the pancreas.",
          ds_meshterms: [
            "Pancreatic Neoplasms",
            "Pancreatic Cancer",
            "Cancer of the Pancreas",
          ],
        },
      },
    },
    ["68010190"],
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].name, "Pancreatic Neoplasms");
  assert.deepEqual(records[0].entryTerms, [
    "Pancreatic Cancer",
    "Cancer of the Pancreas",
  ]);
});

test("assisted keyword list combines original, spell correction, and MeSH terms", () => {
  const keywords = buildAssistedKeywordList({
    originalKeywords: ["panceratic cancer"],
    correctedTerms: [
      {
        original: "panceratic cancer",
        corrected: "pancreatic cancer",
      },
    ],
    meshRecords: [
      {
        meshId: "68010190",
        name: "Pancreatic Neoplasms",
        entryTerms: ["Pancreatic Cancer", "Cancer of the Pancreas"],
      },
    ],
  });

  assert.deepEqual(keywords, [
    "panceratic cancer",
    "pancreatic cancer",
    "pancreatic neoplasms",
    "cancer of the pancreas",
  ]);
});

test("assists PubMed keywords through mocked ESpell and MeSH endpoints", async () => {
  process.env.PUBMED_QUERY_ASSIST_ENABLED = "true";

  server.use(
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/espell.fcgi", ({ request }) => {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get("db"), "pubmed");
      assert.equal(url.searchParams.get("term"), "panceratic cancer");

      return HttpResponse.text(
        `
        <eSpellResult>
          <Query>panceratic cancer</Query>
          <CorrectedQuery>pancreatic cancer</CorrectedQuery>
        </eSpellResult>
        `,
        {
          headers: {
            "Content-Type": "application/xml",
          },
        },
      );
    }),
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", ({ request }) => {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get("db"), "mesh");
      assert.equal(url.searchParams.get("term"), "pancreatic cancer");

      return HttpResponse.json({
        esearchresult: {
          idlist: ["68010190"],
        },
      });
    }),
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", ({ request }) => {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get("db"), "mesh");
      assert.equal(url.searchParams.get("id"), "68010190");

      return HttpResponse.json({
        result: {
          uids: ["68010190"],
          "68010190": {
            uid: "68010190",
            ds_name: "Pancreatic Neoplasms",
            ds_meshterms: [
              "Pancreatic Neoplasms",
              "Pancreatic Cancer",
              "Cancer of the Pancreas",
            ],
          },
        },
      });
    }),
  );

  const result = await assistPubmedKeywords(["panceratic cancer"]);

  assert.deepEqual(result.correctedTerms, [
    {
      original: "panceratic cancer",
      corrected: "pancreatic cancer",
    },
  ]);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.keywords, [
    "panceratic cancer",
    "pancreatic cancer",
    "pancreatic neoplasms",
    "cancer of the pancreas",
  ]);
});
