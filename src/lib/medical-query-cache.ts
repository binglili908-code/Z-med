import { createHash } from "node:crypto";

import {
  type MedicalQueryGroupRole,
  type MedicalQueryLanguage,
  type MedicalQueryPlan,
  type PubmedAssistForMedicalQueryPlan,
} from "@/lib/medical-query-plan";
import { normalizeMatchText } from "@/lib/subscription-matching";

export type MedicalTermCacheKey = {
  term: string;
  role: MedicalQueryGroupRole;
  language: MedicalQueryLanguage;
};

export type MedicalQueryCacheStore = {
  getPlan(rawInput: string[]): Promise<MedicalQueryPlan | null>;
  setPlan(rawInput: string[], plan: MedicalQueryPlan): Promise<void>;
  getTermMapping(key: MedicalTermCacheKey): Promise<PubmedAssistForMedicalQueryPlan | null>;
  setTermMapping(
    key: MedicalTermCacheKey,
    mapping: PubmedAssistForMedicalQueryPlan,
  ): Promise<void>;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type InMemoryMedicalQueryCacheOptions = {
  planTtlMs?: number;
  termTtlMs?: number;
  maxPlanEntries?: number;
  maxTermEntries?: number;
};

const DEFAULT_PLAN_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TERM_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PLAN_ENTRIES = 500;
const DEFAULT_MAX_TERM_ENTRIES = 5000;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneCacheValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

export function normalizeMedicalQueryInput(rawInput: string[]) {
  return rawInput
    .map((item) => normalizeMatchText(item))
    .filter(Boolean)
    .sort();
}

export function buildMedicalQueryInputHash(rawInput: string[]) {
  return sha256(stableJson(normalizeMedicalQueryInput(rawInput)));
}

export function normalizeMedicalTermCacheKey(key: MedicalTermCacheKey) {
  return {
    term: normalizeMatchText(key.term),
    role: key.role,
    language: key.language,
  };
}

export function buildMedicalTermMappingHash(key: MedicalTermCacheKey) {
  return sha256(stableJson(normalizeMedicalTermCacheKey(key)));
}

function getFreshEntry<T>(entries: Map<string, CacheEntry<T>>, key: string) {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return cloneCacheValue(entry.value);
}

function setBoundedEntry<T>(
  entries: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number,
) {
  entries.set(key, {
    value: cloneCacheValue(value),
    expiresAt: Date.now() + ttlMs,
  });

  while (entries.size > maxEntries) {
    const firstKey = entries.keys().next().value;
    if (!firstKey) break;
    entries.delete(firstKey);
  }
}

export function createInMemoryMedicalQueryCache(
  options: InMemoryMedicalQueryCacheOptions = {},
): MedicalQueryCacheStore {
  const planTtlMs = options.planTtlMs ?? DEFAULT_PLAN_TTL_MS;
  const termTtlMs = options.termTtlMs ?? DEFAULT_TERM_TTL_MS;
  const maxPlanEntries = options.maxPlanEntries ?? DEFAULT_MAX_PLAN_ENTRIES;
  const maxTermEntries = options.maxTermEntries ?? DEFAULT_MAX_TERM_ENTRIES;
  const plans = new Map<string, CacheEntry<MedicalQueryPlan>>();
  const termMappings = new Map<string, CacheEntry<PubmedAssistForMedicalQueryPlan>>();

  return {
    async getPlan(rawInput) {
      return getFreshEntry(plans, buildMedicalQueryInputHash(rawInput));
    },
    async setPlan(rawInput, plan) {
      setBoundedEntry(plans, buildMedicalQueryInputHash(rawInput), plan, planTtlMs, maxPlanEntries);
    },
    async getTermMapping(key) {
      return getFreshEntry(termMappings, buildMedicalTermMappingHash(key));
    },
    async setTermMapping(key, mapping) {
      const normalized = normalizeMedicalTermCacheKey(key);
      if (!normalized.term) return;
      setBoundedEntry(
        termMappings,
        buildMedicalTermMappingHash(key),
        mapping,
        termTtlMs,
        maxTermEntries,
      );
    },
  };
}

export function createLayeredMedicalQueryCache(
  stores: Array<MedicalQueryCacheStore | null | undefined>,
): MedicalQueryCacheStore {
  const activeStores = stores.filter((store): store is MedicalQueryCacheStore => Boolean(store));

  return {
    async getPlan(rawInput) {
      for (const store of activeStores) {
        const plan = await store.getPlan(rawInput);
        if (plan) return plan;
      }
      return null;
    },
    async setPlan(rawInput, plan) {
      await Promise.all(activeStores.map((store) => store.setPlan(rawInput, plan)));
    },
    async getTermMapping(key) {
      for (const store of activeStores) {
        const mapping = await store.getTermMapping(key);
        if (mapping) return mapping;
      }
      return null;
    },
    async setTermMapping(key, mapping) {
      await Promise.all(activeStores.map((store) => store.setTermMapping(key, mapping)));
    },
  };
}

export const defaultMedicalQueryCache = createInMemoryMedicalQueryCache();
