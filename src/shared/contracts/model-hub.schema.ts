import { z } from "zod";

import type { ModelHubResponse } from "@/shared/contracts/model-hub";

export const modelHubItemSchema = z.object({
  id: z.string(),
  github_id: z.number(),
  full_name: z.string(),
  owner: z.string(),
  name: z.string(),
  html_url: z.string().url(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  license_spdx: z.string().nullable(),
  topics: z.array(z.string()),
  stargazers_count: z.number(),
  forks_count: z.number(),
  open_issues_count: z.number(),
  watchers_count: z.number(),
  pushed_at: z.string().nullable(),
  github_created_at: z.string().nullable(),
  github_updated_at: z.string().nullable(),
  homepage: z.string().nullable(),
  default_branch: z.string().nullable(),
  category: z.string(),
  task_types: z.array(z.string()),
  domain_tags: z.array(z.string()),
  model_signals: z.array(z.string()),
  quality_flags: z.array(z.string()),
  recommendation_score: z.number(),
  recommendation_reason: z.string().nullable(),
  curator_summary: z.string().nullable(),
  curated_recommendation_reason: z.string().nullable(),
  project_understanding: z.string().nullable(),
  risk_notes: z.string().nullable(),
  target_users: z.array(z.string()),
  curation_tags: z.array(z.string()),
  curated_score: z.number().nullable(),
  curation_status: z.string().nullable(),
  curated_at: z.string().nullable(),
  curated_by: z.string().nullable(),
  curation_notes: z.string().nullable(),
  source_queries: z.array(z.string()),
  last_synced_at: z.string().nullable(),
});

export const modelHubResponseSchema = z.object({
  items: z.array(modelHubItemSchema),
  total: z.number(),
  category: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  configured: z.boolean(),
});

export function validateModelHubResponse(response: ModelHubResponse) {
  return modelHubResponseSchema.parse(response);
}
