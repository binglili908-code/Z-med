import { z } from "zod";

import type { FeedResponse } from "@/shared/contracts/papers";

export const paperQualityTierSchema = z.enum(["top", "core", "emerging"]);
export const recommendationSourceTypeSchema = z.enum([
  "precision",
  "trending",
  "serendipity",
]);

export const paperAiAnalysisSchema = z.object({
  summary_zh: z.string(),
  background: z.string(),
  method: z.string(),
  value: z.string(),
});

export const paperTopicSchema = z.object({
  name_zh: z.string(),
  confidence: z.number(),
});

export const paperCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  title_zh: z.string().nullable(),
  journal: z.string(),
  journal_if: z.number().nullable(),
  journal_jcr: z.string().nullable(),
  journal_cas_zone: z.string().nullable(),
  publication_date: z.string().nullable(),
  quality_score: z.number(),
  quality_tier: paperQualityTierSchema,
  pubmed_url: z.string(),
  is_open_access: z.boolean(),
  oa_pdf_url: z.string().nullable(),
  abstract: z.string().nullable(),
  abstract_zh: z.string().nullable(),
  ai_analysis: paperAiAnalysisSchema.nullable(),
  source_type: recommendationSourceTypeSchema,
  recommendation_reason: z.string().nullable(),
  pdf_emailed_at: z.string().nullable(),
});

export const feedPaperSchema = paperCardSchema.extend({
  topics: z.array(paperTopicSchema),
  recommendation_score: z.number(),
});

export const feedResponseSchema = z.object({
  papers: z.array(feedPaperSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  personalized: z.boolean(),
  hasSubscription: z.boolean(),
  requiresLogin: z.boolean(),
  exactMatchTotal: z.number().optional(),
  strictMatchFallback: z.boolean().optional(),
  strictMatchMessage: z.string().nullable().optional(),
  fallbackType: z.literal("topic").nullable().optional(),
  devBypassAuth: z.boolean().optional(),
  devBypassUserId: z.string().nullable().optional(),
  devBypassSeedEmail: z.string().nullable().optional(),
});

export function validateFeedResponse(response: FeedResponse) {
  return feedResponseSchema.parse(response);
}
