"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Container } from "@/components/site/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SearchPaper = {
  id: string;
  title: string | null;
  title_zh?: string | null;
  abstract: string | null;
  abstract_zh: string | null;
  journal: string | null;
  publication_date: string | null;
  pubmed_url: string | null;
  is_open_access: boolean | null;
  quality_tier: string | null;
  keywords: string[] | null;
  mesh_terms?: string[] | null;
};

type SearchResponse = {
  total: number;
  items: SearchPaper[];
};

function previewText(text: string | null, fallback = "暂无摘要") {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 220)}…`;
}

function buildSearchParams(input: {
  q?: string;
  tier?: string;
  oaOnly?: boolean;
  from?: string;
  to?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  const q = (input.q ?? "").trim();
  const tier = (input.tier ?? "").trim();
  const from = (input.from ?? "").trim();
  const to = (input.to ?? "").trim();

  if (q) params.set("q", q);
  if (tier) params.set("tier", tier);
  if (input.oaOnly) params.set("oa", "true");
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  params.set("page", String(Math.max(1, input.page ?? 1)));
  params.set("pageSize", "10");
  return params;
}

function normalizeHighlightTerms(q: string) {
  return Array.from(
    new Set(
      q
        .replace(/,/g, " ")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(text: string | null | undefined, terms: string[]) {
  const content = text ?? "";
  if (!content || !terms.length) return content;

  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const parts = content.split(regex);

  return parts.map((part, index) => {
    const matched = terms.some((term) => part.toLowerCase() === term.toLowerCase());
    if (!matched) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-amber-100 px-1 py-0.5 text-inherit"
      >
        {part}
      </mark>
    );
  });
}

export function LiteratureSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = (searchParams.get("q") ?? "").trim();
  const initialTier = (searchParams.get("tier") ?? "").trim();
  const initialOa = searchParams.get("oa") === "true";
  const initialFrom = (searchParams.get("from") ?? "").trim();
  const initialTo = (searchParams.get("to") ?? "").trim();
  const initialPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [query, setQuery] = React.useState(initialQ);
  const [tier, setTier] = React.useState(initialTier);
  const [oaOnly, setOaOnly] = React.useState(initialOa);
  const [fromDate, setFromDate] = React.useState(initialFrom);
  const [toDate, setToDate] = React.useState(initialTo);
  const [loading, setLoading] = React.useState(false);
  const [total, setTotal] = React.useState(0);
  const [items, setItems] = React.useState<SearchPaper[]>([]);
  const highlightTerms = React.useMemo(() => normalizeHighlightTerms(initialQ), [initialQ]);
  const hasActiveFilters = Boolean(initialQ || initialTier || initialOa || initialFrom || initialTo);

  React.useEffect(() => {
    setQuery(initialQ);
    setTier(initialTier);
    setOaOnly(initialOa);
    setFromDate(initialFrom);
    setToDate(initialTo);
  }, [initialFrom, initialOa, initialQ, initialTier, initialTo]);

  React.useEffect(() => {
    const controller = new AbortController();
    const params = buildSearchParams({
      q: initialQ,
      tier: initialTier,
      oaOnly: initialOa,
      from: initialFrom,
      to: initialTo,
      page: initialPage,
    });

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/papers/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          setItems([]);
          setTotal(0);
          return;
        }
        const json = (await res.json()) as SearchResponse;
        setItems(json.items ?? []);
        setTotal(Number(json.total ?? 0));
      } catch {
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [initialFrom, initialOa, initialPage, initialQ, initialTier, initialTo]);

  const onSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const params = buildSearchParams({
        q: query,
        tier,
        oaOnly,
        from: fromDate,
        to: toDate,
        page: 1,
      });
      router.push(`/literature-trends?${params.toString()}`);
    },
    [fromDate, oaOnly, query, router, tier, toDate],
  );

  const goPage = React.useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(nextPage));
      router.push(`/literature-trends?${params.toString()}`);
    },
    [router, searchParams],
  );

  const keepQueryResetFilters = React.useCallback(() => {
    const params = buildSearchParams({ q: initialQ, page: 1 });
    router.push(`/literature-trends?${params.toString()}`);
  }, [initialQ, router]);

  const clearAllFilters = React.useCallback(() => {
    router.push("/literature-trends?page=1&pageSize=10");
  }, [router]);

  const totalPages = Math.max(1, Math.ceil(total / 10));

  return (
    <Container className="py-10">
      <Card>
        <CardHeader>
          <CardTitle>文献库搜索</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入标题、摘要、期刊、关键词或 MeSH 词"
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
              <select
                value={tier}
                onChange={(event) => setTier(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              >
                <option value="">全部分层</option>
                <option value="top">Top</option>
                <option value="core">Core</option>
                <option value="emerging">Emerging</option>
              </select>
              <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={oaOnly}
                  onChange={(event) => setOaOnly(event.target.checked)}
                />
                仅看开放获取
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
                aria-label="开始日期"
              />
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
                aria-label="结束日期"
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                搜索
              </button>
            </div>
          </form>

          <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
            <div>共找到 {total} 篇结果</div>
            <div>{hasActiveFilters ? "当前筛选条件已完整保留，可翻页后继续调整。" : "支持从首页输入关键词直接跳转到这里继续检索"}</div>
          </div>

          {hasActiveFilters ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              {initialQ ? <span className="rounded-full bg-slate-100 px-3 py-1">关键词：{initialQ}</span> : null}
              {initialTier ? <span className="rounded-full bg-slate-100 px-3 py-1">分层：{initialTier}</span> : null}
              {initialOa ? <span className="rounded-full bg-slate-100 px-3 py-1">仅 OA</span> : null}
              {initialFrom ? <span className="rounded-full bg-slate-100 px-3 py-1">开始：{initialFrom}</span> : null}
              {initialTo ? <span className="rounded-full bg-slate-100 px-3 py-1">结束：{initialTo}</span> : null}
            </div>
          ) : null}

          {loading ? <div className="mt-6 text-sm text-slate-500">搜索中...</div> : null}

          {!loading && !items.length ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
              <div className="text-base font-semibold text-slate-800">暂未找到匹配文献</div>
              <div className="mt-2 text-sm text-slate-500">
                {hasActiveFilters
                  ? "可尝试缩短关键词、改用英文术语，或放宽 OA、分层、日期范围。"
                  : "当前文献库暂无可展示结果，请稍后再试。"}
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {initialQ ? (
                  <button
                    type="button"
                    onClick={keepQueryResetFilters}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    仅保留关键词重试
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  清空全部筛选
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 space-y-4">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                    {item.journal ?? "PubMed"}
                  </span>
                  {item.quality_tier ? (
                    <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                      {item.quality_tier}
                    </span>
                  ) : null}
                  <span>{item.publication_date ?? "日期未知"}</span>
                  <span>{item.is_open_access ? "Open Access" : "Closed Access"}</span>
                </div>

                <a
                  href={item.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/"}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block text-lg font-semibold leading-7 text-slate-900 hover:text-teal-700"
                >
                  {renderHighlightedText(item.title ?? "未命名文献", highlightTerms)}
                </a>
                {item.title_zh ? (
                  <div className="mt-1 text-sm text-slate-600">
                    {renderHighlightedText(item.title_zh, highlightTerms)}
                  </div>
                ) : null}

                <p className="mt-3 text-sm leading-6 text-slate-700">
                  {renderHighlightedText(
                    previewText(item.abstract_zh || item.abstract, "暂无中英文摘要"),
                    highlightTerms,
                  )}
                </p>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                  {(item.keywords ?? []).slice(0, 4).map((keyword) => (
                    <span key={`${item.id}-${keyword}`} className="rounded-full border border-slate-200 px-2 py-1">
                      {renderHighlightedText(keyword, highlightTerms)}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>

          {total > 0 ? (
            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                disabled={initialPage <= 1}
                onClick={() => goPage(Math.max(1, initialPage - 1))}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                上一页
              </button>
              <div className="text-sm text-slate-500">
                第 {initialPage} / {totalPages} 页
              </div>
              <button
                type="button"
                disabled={initialPage >= totalPages}
                onClick={() => goPage(Math.min(totalPages, initialPage + 1))}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Container>
  );
}
