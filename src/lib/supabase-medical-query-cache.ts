import type { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  buildMedicalQueryInputHash,
  buildMedicalTermMappingHash,
  normalizeMedicalQueryInput,
  normalizeMedicalTermCacheKey,
  type MedicalQueryCacheStore,
  type MedicalTermCacheKey,
} from "@/lib/medical-query-cache";
import type {
  MedicalQueryPlan,
  PubmedAssistForMedicalQueryPlan,
} from "@/lib/medical-query-plan";
import {
  isMissingColumnError,
  isMissingRelationError,
} from "@/server/repositories/schema-compat";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

const PLAN_TTL_DAYS = 30;
const TERM_TTL_DAYS = 180;

function expiresAt(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isMissingPersistenceTable(error: unknown) {
  const value = error as { code?: string; message?: string; details?: string } | null;
  const text = `${value?.message ?? ""}\n${value?.details ?? ""}`;
  return (
    isMissingColumnError(error) ||
    isMissingRelationError(error) ||
    /could not find .* table/i.test(text)
  );
}

function freshExpiresAt(value: unknown) {
  if (typeof value !== "string" || !value) return true;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time > Date.now() : true;
}

function safePlan(value: unknown): MedicalQueryPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as MedicalQueryPlan;
  return Array.isArray(plan.rawInput) && Array.isArray(plan.groups) && Array.isArray(plan.intents)
    ? plan
    : null;
}

function safeMapping(value: unknown): PubmedAssistForMedicalQueryPlan | null {
  if (!value || typeof value !== "object") return null;
  const mapping = value as PubmedAssistForMedicalQueryPlan;
  return Array.isArray(mapping.keywords) &&
    Array.isArray(mapping.correctedTerms) &&
    Array.isArray(mapping.meshRecords) &&
    Array.isArray(mapping.errors)
    ? mapping
    : null;
}

export function createSupabaseMedicalQueryCache(
  client: SupabaseDbClient,
): MedicalQueryCacheStore {
  return {
    async getPlan(rawInput) {
      const inputHash = buildMedicalQueryInputHash(rawInput);
      const { data, error } = await client
        .from("medical_query_plan_cache")
        .select("plan,expires_at,usage_count")
        .eq("input_hash", inputHash)
        .maybeSingle();
      if (error) {
        if (isMissingPersistenceTable(error)) return null;
        return null;
      }
      if (!data || !freshExpiresAt((data as any).expires_at)) return null;

      await client
        .from("medical_query_plan_cache")
        .update({
          usage_count: Number((data as any).usage_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("input_hash", inputHash);
      return safePlan((data as any).plan);
    },

    async setPlan(rawInput, plan) {
      const inputHash = buildMedicalQueryInputHash(rawInput);
      const { error } = await client.from("medical_query_plan_cache").upsert(
        {
          input_hash: inputHash,
          raw_input: rawInput,
          normalized_input: normalizeMedicalQueryInput(rawInput),
          plan,
          source: "minimax_pubmed",
          expires_at: expiresAt(PLAN_TTL_DAYS),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "input_hash" },
      );
      if (error && !isMissingPersistenceTable(error)) {
        console.error("[medical-query-plan-cache-write]", error.message);
      }
    },

    async getTermMapping(key: MedicalTermCacheKey) {
      const termHash = buildMedicalTermMappingHash(key);
      const { data, error } = await client
        .from("medical_term_mapping_cache")
        .select("mapping,expires_at,usage_count")
        .eq("term_hash", termHash)
        .maybeSingle();
      if (error) {
        if (isMissingPersistenceTable(error)) return null;
        return null;
      }
      if (!data || !freshExpiresAt((data as any).expires_at)) return null;

      await client
        .from("medical_term_mapping_cache")
        .update({
          usage_count: Number((data as any).usage_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("term_hash", termHash);
      return safeMapping((data as any).mapping);
    },

    async setTermMapping(key, mapping) {
      const normalized = normalizeMedicalTermCacheKey(key);
      if (!normalized.term) return;

      const { error } = await client.from("medical_term_mapping_cache").upsert(
        {
          term_hash: buildMedicalTermMappingHash(key),
          raw_term: key.term,
          normalized_term: normalized.term,
          role_hint: normalized.role,
          language: normalized.language,
          mapping,
          source: "pubmed_mesh",
          expires_at: expiresAt(TERM_TTL_DAYS),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "term_hash" },
      );
      if (error && !isMissingPersistenceTable(error)) {
        console.error("[medical-term-mapping-cache-write]", error.message);
      }
    },
  };
}
