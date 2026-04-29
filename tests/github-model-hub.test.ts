import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreGitHubModelHubCandidate,
  type GitHubModelHubRepository,
} from "../src/lib/github-model-hub";

function repo(overrides: Partial<GitHubModelHubRepository> = {}): GitHubModelHubRepository {
  return {
    id: 1001,
    full_name: "lab/medical-imaging-segmentation",
    name: "medical-imaging-segmentation",
    html_url: "https://github.com/lab/medical-imaging-segmentation",
    description: "PyTorch deep learning framework for medical imaging segmentation",
    language: "Python",
    license: { spdx_id: "MIT", name: "MIT License" },
    topics: ["medical-imaging", "deep-learning", "pytorch", "segmentation"],
    stargazers_count: 1200,
    forks_count: 120,
    open_issues_count: 12,
    watchers_count: 1200,
    pushed_at: "2026-04-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    homepage: null,
    default_branch: "main",
    archived: false,
    disabled: false,
    ...overrides,
  };
}

const source = {
  id: "medical-imaging-stars",
  category: "medical-imaging",
  label: "医学影像高星项目",
};

test("scores a relevant medical AI repository", () => {
  const scored = scoreGitHubModelHubCandidate(repo(), source);
  assert.ok(scored);
  assert.equal(scored.category, "medical-imaging");
  assert.ok(scored.recommendation_score > 0);
  assert.ok(scored.domain_tags.includes("medical-imaging"));
  assert.ok(scored.task_types.includes("segmentation"));
  assert.ok(scored.model_signals.includes("trainable-code"));
});

test("rejects generic AI repositories without medical signals", () => {
  const scored = scoreGitHubModelHubCandidate(
    repo({
      full_name: "lab/awesome-ai-prompts",
      name: "awesome-ai-prompts",
      description: "Prompt collection for AI agents and generic LLM apps",
      topics: ["ai", "llm", "prompt-engineering"],
    }),
    source,
  );
  assert.equal(scored, null);
});

test("keeps resource lists but marks them for review", () => {
  const scored = scoreGitHubModelHubCandidate(
    repo({
      full_name: "lab/awesome-medical-imaging",
      name: "awesome-medical-imaging",
      description: "Awesome reading list for medical imaging deep learning papers",
      topics: ["awesome-list", "medical-imaging", "deep-learning"],
      stargazers_count: 300,
    }),
    source,
  );
  assert.ok(scored);
  assert.ok(scored.task_types.includes("resource-list"));
  assert.ok(scored.quality_flags.includes("resource-list"));
});
