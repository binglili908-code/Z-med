export type ModelHubItem = {
  id: string;
  github_id: number;
  full_name: string;
  owner: string;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  license_spdx: string | null;
  topics: string[];
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  pushed_at: string | null;
  github_created_at: string | null;
  github_updated_at: string | null;
  homepage: string | null;
  default_branch: string | null;
  category: string;
  task_types: string[];
  domain_tags: string[];
  model_signals: string[];
  quality_flags: string[];
  recommendation_score: number;
  recommendation_reason: string | null;
  source_queries: string[];
  last_synced_at: string | null;
};

export type ModelHubResponse = {
  items: ModelHubItem[];
  total: number;
  category: string | null;
  lastSyncedAt: string | null;
  configured: boolean;
};
