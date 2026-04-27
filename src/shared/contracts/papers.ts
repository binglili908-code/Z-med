export type PaperQualityTier = "top" | "core" | "emerging";

export type RecommendationSourceType = "precision" | "trending" | "serendipity";

export type PaperAiAnalysis = {
  summary_zh: string;
  background: string;
  method: string;
  value: string;
};

export type PaperTopic = {
  name_zh: string;
  confidence: number;
};

export type PaperCard = {
  id: string;
  title: string;
  title_zh: string | null;
  journal: string;
  journal_if: number | null;
  journal_jcr: string | null;
  journal_cas_zone: string | null;
  publication_date: string | null;
  quality_score: number;
  quality_tier: PaperQualityTier;
  pubmed_url: string;
  is_open_access: boolean;
  oa_pdf_url: string | null;
  abstract: string | null;
  abstract_zh: string | null;
  ai_analysis: PaperAiAnalysis | null;
  source_type: RecommendationSourceType;
  recommendation_reason: string | null;
  pdf_emailed_at: string | null;
};

export type FeedPaper = PaperCard & {
  topics: PaperTopic[];
  recommendation_score: number;
};

export type FeedResponse = {
  papers: FeedPaper[];
  total: number;
  page: number;
  pageSize: number;
  personalized: boolean;
  hasSubscription: boolean;
  requiresLogin: boolean;
  devBypassAuth?: boolean;
  devBypassUserId?: string | null;
  devBypassSeedEmail?: string | null;
};
