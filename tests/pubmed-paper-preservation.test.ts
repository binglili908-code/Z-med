import assert from "node:assert/strict";
import test from "node:test";

import { preserveFetchedPaperFields } from "../src/lib/pubmed-paper-preservation";

test("preserves existing abstract and OA fields when fresh fetch did not resolve them", () => {
  const fields = preserveFetchedPaperFields({
    fetchedAbstract: null,
    openAccess: {
      resolved: false,
      is_open_access: false,
      oa_pdf_url: null,
    },
    existing: {
      abstract: "Existing abstract",
      is_open_access: true,
      oa_pdf_url: "https://example.com/paper.pdf",
    },
  });

  assert.deepEqual(fields, {
    abstract: "Existing abstract",
    is_open_access: true,
    oa_pdf_url: "https://example.com/paper.pdf",
  });
});

test("uses resolved OA values even when they clear a stale existing PDF", () => {
  const fields = preserveFetchedPaperFields({
    fetchedAbstract: "Fresh abstract",
    openAccess: {
      resolved: true,
      is_open_access: false,
      oa_pdf_url: null,
    },
    existing: {
      abstract: "Existing abstract",
      is_open_access: true,
      oa_pdf_url: "https://example.com/stale.pdf",
    },
  });

  assert.deepEqual(fields, {
    abstract: "Fresh abstract",
    is_open_access: false,
    oa_pdf_url: null,
  });
});
