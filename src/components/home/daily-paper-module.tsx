"use client";

import * as React from "react";

import Link from "next/link";
import { Clock, Sparkles } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

type FeedPaper = {
  id: string;
  title: string;
  journal: string;
  publication_date: string | null;
  abstract_zh: string | null;
  quality_score: number;
  quality_tier: "top" | "core" | "emerging";
  pubmed_url: string;
  is_open_access: boolean;
  oa_pdf_url: string | null;
  ai_analysis: {
    summary_zh: string;
    background: string;
    method: string;
    value: string;
  } | null;
  source_type: "precision" | "trending" | "serendipity";
  recommendation_reason: string | null;
  pdf_emailed_at: string | null;
};

type FeedResponse = {
  papers: FeedPaper[];
  total: number;
  page: number;
  pageSize: number;
  personalized: boolean;
  hasSubscription?: boolean;
  requiresLogin: boolean;
  devBypassAuth?: boolean;
  devBypassUserId?: string | null;
  devBypassSeedEmail?: string | null;
};

type SendApiResponse = {
  ok?: boolean;
  emailedTo?: string;
  count?: number;
  error?: string;
};

type SelfCheckResponse = {
  ok?: boolean;
  checks?: {
    bypassEnabled?: boolean;
    seedEmail?: string | null;
    resolvedUserId?: string | null;
    profileEmail?: string | null;
    profileActive?: boolean | null;
    resendConfigured?: boolean;
    openAccessPaperCount?: number;
    samplePaperId?: string | null;
    samplePaperTitle?: string | null;
  };
  error?: string;
};

type SyncApiResponse = {
  ok?: boolean;
  error?: string;
  upsertedCount?: number;
  aiMedCount?: number;
};

type DailyPaperView = {
  id: string;
  title: string;
  journal: string;
  date: string;
  qualityScore: number | null;
  qualityTier: string | null;
  pubmedUrl: string;
  isOpenAccess: boolean;
  oaPdfUrl: string | null;
  pdfEmailedAt: string | null;
  tagsRaw: string[];
  abstractZh: string;
  sourceType: "precision" | "trending" | "serendipity";
  recommendationReason: string | null;
};

function parseDate(date: string | null) {
  return date ?? "Today";
}

function resolveAbstractZh(
  abstractZh: string | null,
  ai: Record<string, unknown> | null,
  fallbackDate: string,
) {
  if (abstractZh?.trim()) return abstractZh.trim();
  if (typeof ai?.summary_zh === "string" && ai.summary_zh.trim()) return ai.summary_zh.trim();
  return `中文摘要待生成（文献发布日期 ${fallbackDate}）。`;
}

function toDailyPaperView(p: FeedPaper): DailyPaperView {
  const journal = p.journal ?? "PubMed";
  const date = parseDate(p.publication_date);
  const abstractZh = resolveAbstractZh(p.abstract_zh, p.ai_analysis, date);

  return {
    id: p.id,
    title: p.title,
    journal,
    date,
    qualityScore: p.quality_score ?? null,
    qualityTier: p.quality_tier ?? null,
    pubmedUrl: p.pubmed_url,
    isOpenAccess: p.is_open_access,
    oaPdfUrl: p.oa_pdf_url,
    pdfEmailedAt: p.pdf_emailed_at,
    tagsRaw: [],
    abstractZh,
    sourceType: p.source_type,
    recommendationReason: p.recommendation_reason,
  };
}

const fallbackPaper: DailyPaperView = {
  id: "fallback",
  title: "正在获取今日最新文献…",
  journal: "PubMed",
  date: "Today",
  qualityScore: null,
  qualityTier: null,
  pubmedUrl: "https://pubmed.ncbi.nlm.nih.gov/",
  isOpenAccess: false,
  oaPdfUrl: null,
  pdfEmailedAt: null,
  tagsRaw: [],
  abstractZh: "中文摘要加载中（占位）。",
  sourceType: "precision",
  recommendationReason: null,
};

export function DailyPaperModule() {
  const [paper, setPaper] = React.useState<DailyPaperView>(fallbackPaper);
  const [items, setItems] = React.useState<DailyPaperView[]>([]);
  const [requiresLogin, setRequiresLogin] = React.useState(false);
  const [hasSubscription, setHasSubscription] = React.useState(false);
  const [devBypassAuth, setDevBypassAuth] = React.useState(false);
  const [devBypassUserId, setDevBypassUserId] = React.useState<string | null>(null);
  const [devBypassSeedEmail, setDevBypassSeedEmail] = React.useState<string | null>(null);
  const [digestSendState, setDigestSendState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [lastSendMessage, setLastSendMessage] = React.useState<string | null>(null);
  const [selfCheckLoading, setSelfCheckLoading] = React.useState(false);
  const [selfCheckMessage, setSelfCheckMessage] = React.useState<string | null>(null);
  const [syncLoading, setSyncLoading] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);
  const [expandedSummaryIds, setExpandedSummaryIds] = React.useState<Record<string, boolean>>({});

  const getAccessToken = React.useCallback(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    const supabase = createClient(url, anon);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const loadFeed = React.useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/papers/spotlight", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const json = (await res.json()) as FeedResponse;
      setRequiresLogin(Boolean(json.requiresLogin));
      setHasSubscription(Boolean(json.hasSubscription));
      setDevBypassAuth(Boolean(json.devBypassAuth));
      setDevBypassUserId(json.devBypassUserId ?? null);
      setDevBypassSeedEmail(json.devBypassSeedEmail ?? null);
      const rows = (json.papers ?? []).map(toDailyPaperView);
      if (rows.length) {
        setPaper(rows[0]);
      }
      setItems(rows.slice(1));
      setExpandedSummaryIds({});
      setDigestSendState("idle");
    } catch {
      return;
    }
  }, [getAccessToken]);

  React.useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const handleSendSpotlight = React.useCallback(async () => {
    setDigestSendState("sending");
    setLastSendMessage(null);
    try {
      const token = await getAccessToken();
      if (!token && !devBypassAuth) {
        setDigestSendState("error");
        return;
      }
      const res = await fetch("/api/send-spotlight-email", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const payload = (await res.json()) as SendApiResponse;
      if (!res.ok) {
        setLastSendMessage(payload.error ?? "发送失败，请重试");
        setDigestSendState("error");
        return;
      }
      setLastSendMessage(
        payload.emailedTo
          ? `发送成功：${payload.emailedTo}（共 ${payload.count ?? 0} 篇）`
          : "发送成功",
      );
      setDigestSendState("sent");
    } catch {
      setLastSendMessage("发送失败，请重试");
      setDigestSendState("error");
    }
  }, [devBypassAuth, getAccessToken]);

  const digestButtonLabel = React.useCallback(() => {
    if (digestSendState === "sending") return "发送中…";
    if (digestSendState === "sent") return "已发送";
    if (digestSendState === "error") return "发送失败，重试";
    return "发送本期7篇到我的邮箱";
  }, [digestSendState]);

  const previewSummary = React.useCallback((text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= 120) return normalized;
    return `${normalized.slice(0, 120)}…`;
  }, []);

  const sourceTypeLabel = React.useCallback((sourceType: DailyPaperView["sourceType"]) => {
    if (sourceType === "trending") return "🔥 全局热点";
    if (sourceType === "serendipity") return "💡 跨界推荐";
    return null;
  }, []);

  const toggleSummary = React.useCallback((paperId: string) => {
    setExpandedSummaryIds((prev) => ({ ...prev, [paperId]: !prev[paperId] }));
  }, []);

  const isSummaryExpanded = React.useCallback(
    (paperId: string) => Boolean(expandedSummaryIds[paperId]),
    [expandedSummaryIds],
  );

  const handleSelfCheck = React.useCallback(async () => {
    setSelfCheckLoading(true);
    setSelfCheckMessage(null);
    try {
      const res = await fetch("/api/dev/self-check", { cache: "no-store" });
      const payload = (await res.json()) as SelfCheckResponse;
      if (!res.ok) {
        setSelfCheckMessage(payload.error ?? "自检失败");
        return;
      }
      const checks = payload.checks;
      if (payload.ok) {
        setSelfCheckMessage(
          `自检通过：旁路用户 ${checks?.resolvedUserId}，OA 文献 ${checks?.openAccessPaperCount ?? 0} 篇`,
        );
      } else {
        setSelfCheckMessage(
          `自检未通过：用户ID=${checks?.resolvedUserId ?? "无"}，邮箱=${checks?.profileEmail ?? "无"}，OA=${checks?.openAccessPaperCount ?? 0}，Resend=${checks?.resendConfigured ? "OK" : "缺失"}`,
        );
      }
    } catch {
      setSelfCheckMessage("自检请求失败");
    } finally {
      setSelfCheckLoading(false);
    }
  }, []);

  const handleSyncNow = React.useCallback(async () => {
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/cron/pubmed-sync", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await res.json()) as SyncApiResponse;
      if (!res.ok || !payload.ok) {
        setSyncMessage(payload.error ?? "同步失败");
        return;
      }
      setSyncMessage(
        `同步完成：新增/更新 ${payload.upsertedCount ?? 0} 篇，AI+医学 ${payload.aiMedCount ?? 0} 篇`,
      );
      await loadFeed();
    } catch {
      setSyncMessage("同步请求失败");
    } finally {
      setSyncLoading(false);
    }
  }, [loadFeed]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-teal-50 rounded-full blur-3xl -mr-20 -mt-20 opacity-50 pointer-events-none"></div>

      <div className="flex items-center gap-2 mb-6">
        <span className="bg-teal-100 text-teal-800 p-1.5 rounded-md">
          <Sparkles className="w-5 h-5" />
        </span>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">
          AI 每日速递 (Daily Top)
        </h2>
        <a
          href={paper.pubmedUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs font-bold text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Open in PubMed
        </a>
      </div>

      {requiresLogin ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          个性化订阅和邮件发送功能需登录后使用。{" "}
          <Link href="/signin" className="font-semibold text-slate-900 underline">
            请先登录
          </Link>
        </div>
      ) : null}

      <div className="mb-6 z-10">
        <div className="flex items-center gap-3 mb-3">
          <span className="px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs font-bold tracking-wider uppercase">
            {paper.journal}
          </span>
          <span className="text-xs font-medium text-slate-500 border border-slate-200 px-2.5 py-1 rounded-md">
            {paper.isOpenAccess ? "Open Access" : "Closed Access"}
          </span>
          {(paper.qualityTier ?? "").toLowerCase() === "top" ? (
            <span className="text-xs font-medium text-amber-700 border border-amber-300 bg-amber-50 px-2.5 py-1 rounded-md">
              Top Tier
            </span>
          ) : null}
          {sourceTypeLabel(paper.sourceType) ? (
            <span className="text-xs font-medium text-blue-700 border border-blue-300 bg-blue-50 px-2.5 py-1 rounded-md">
              {sourceTypeLabel(paper.sourceType)}
            </span>
          ) : null}
          <span className="ml-auto text-xs font-medium text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {paper.date}
          </span>
        </div>
        <a
          href={paper.pubmedUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-2xl font-bold text-slate-900 leading-snug mb-2 hover:text-teal-700 transition-colors"
        >
          {paper.title}
        </a>
        {paper.recommendationReason ? (
          <p className="mb-2 text-xs text-slate-500">{paper.recommendationReason}</p>
        ) : null}
        <button
          type="button"
          onClick={() => toggleSummary(paper.id)}
          className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {isSummaryExpanded(paper.id) ? "收起摘要" : "摘要"}
        </button>
      </div>

      <div className="mb-4">
        <button
          type="button"
          disabled={requiresLogin || digestSendState === "sending" || digestSendState === "sent"}
          onClick={handleSendSpotlight}
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-800 transition-colors"
        >
          {digestButtonLabel()}
        </button>
        {requiresLogin ? (
          <p className="mt-2 text-xs text-slate-500">
            登录后可按你的订阅词个性化推送并发送全文。请先登录。
          </p>
        ) : null}
        {!requiresLogin && devBypassAuth ? (
          <p className="mt-2 text-xs text-amber-600">当前为开发免登录模式，仅用于本地测试。</p>
        ) : null}
        {!requiresLogin && !hasSubscription ? (
          <p className="mt-2 text-xs text-slate-500">
            你当前还未配置订阅，正在展示全局高分文献。{" "}
            <Link href="/settings" className="font-semibold text-slate-900 underline">
              去设置页配置订阅
            </Link>
          </p>
        ) : null}
        {lastSendMessage ? (
          <p className="mt-2 text-xs text-slate-600">{lastSendMessage}</p>
        ) : null}
      </div>

      <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 flex-grow z-10">
        <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <div className="w-1.5 h-4 bg-teal-500 rounded-full"></div>
          中文摘要
        </h4>
        <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
          {isSummaryExpanded(paper.id) ? paper.abstractZh : previewSummary(paper.abstractZh)}
        </p>
        <div
          className={`mt-2 overflow-hidden transition-all duration-300 ${
            isSummaryExpanded(paper.id) ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <p className="text-xs text-slate-500">已展开完整摘要</p>
        </div>
      </div>

      {items.length ? (
        <div className="mt-4 space-y-3">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <a
                href={it.pubmedUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-slate-900 hover:text-teal-700"
              >
                {it.title}
              </a>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {it.journal} · {it.date}
                  {(it.qualityTier ?? "").toLowerCase() === "top" ? " · Top Tier" : ""}
                  {sourceTypeLabel(it.sourceType) ? ` · ${sourceTypeLabel(it.sourceType)}` : ""}
                  {it.recommendationReason ? ` · ${it.recommendationReason}` : ""}
                </div>
                <button
                  type="button"
                  onClick={() => toggleSummary(it.id)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {isSummaryExpanded(it.id) ? "收起摘要" : "摘要"}
                </button>
              </div>
              {isSummaryExpanded(it.id) ? (
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">
                  {it.abstractZh}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {devBypassAuth ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="font-semibold">开发工具小面板</div>
          <div className="mt-1">免登录开关：已开启</div>
          <div className="mt-1">当前旁路用户ID：{devBypassUserId ?? "未解析（请检查 DEV_BYPASS_USER_ID）"}</div>
          <div className="mt-1">种子邮箱：{devBypassSeedEmail ?? "未设置"}</div>
          <div className="mt-1">最近一次发送结果：{lastSendMessage ?? "暂无"}</div>
          <div className="mt-3">
            <button
              type="button"
              onClick={handleSelfCheck}
              disabled={selfCheckLoading}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-amber-100"
            >
              {selfCheckLoading ? "自检中…" : "面板内一键自检"}
            </button>
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncLoading}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-amber-100"
            >
              {syncLoading ? "同步中…" : "一键抓取最新文献"}
            </button>
          </div>
          <div className="mt-2">{selfCheckMessage ?? "点击按钮检查用户解析、OA文献与邮件配置。"}</div>
          <div className="mt-1">{syncMessage ?? "点击按钮触发同步任务并自动刷新文献列表。"}</div>
        </div>
      ) : null}
    </div>
  );
}
