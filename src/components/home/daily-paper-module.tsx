"use client";

import * as React from "react";

import Link from "next/link";
import { Brain, Clock, Dna, Sparkles, Stethoscope } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

type FeedPaper = {
  id: string;
  title: string;
  journal: string | null;
  publicationDate: string | null;
  qualityScore: number | null;
  qualityTier: string | null;
  pubmedUrl: string;
  isOpenAccess: boolean;
  oaPdfUrl: string | null;
  aiAnalysis: Record<string, unknown> | null;
  tags: string[];
  topics: Array<{ slug: string; nameZh: string | null; nameEn: string | null }>;
  pdfEmailedAt: string | null;
};

type FeedResponse = {
  featured: FeedPaper | null;
  items: FeedPaper[];
  total?: number;
  personalized: boolean;
  requiresLogin: boolean;
  devBypassAuth?: boolean;
  devBypassUserId?: string | null;
  devBypassSeedEmail?: string | null;
};

type SendApiResponse = {
  ok?: boolean;
  emailedTo?: string;
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

type TopicListResponse = {
  items?: Array<{
    id: string;
    slug: string;
    name_zh: string | null;
    name_en: string | null;
  }>;
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
  topics: Array<{ slug: string; nameZh: string | null; nameEn: string | null }>;
  aiDigest: {
    summaryZh: string;
    background: string;
    method: string;
    value: string;
  };
};

function parseDate(date: string | null) {
  return date ?? "Today";
}

function fromAiAnalysis(ai: Record<string, unknown> | null, fallbackDate: string) {
  const summaryZh =
    typeof ai?.summary_zh === "string"
      ? ai.summary_zh
      : `数据库已同步该文献，发布日期 ${fallbackDate}。如需更深入临床可用性总结，可后续启用 AI 自动结构化分析。`;
  const background =
    typeof ai?.background === "string"
      ? ai.background
      : "待生成（研究背景与动机）";
  const method =
    typeof ai?.method === "string"
      ? ai.method
      : "待生成（核心方法与创新点）";
  const value =
    typeof ai?.value === "string"
      ? ai.value
      : "待生成（临床与科研价值）";

  return { summaryZh, background, method, value };
}

function toDailyPaperView(p: FeedPaper): DailyPaperView {
  const journal = p.journal ?? "PubMed";
  const date = parseDate(p.publicationDate);
  const ai = fromAiAnalysis(p.aiAnalysis, date);

  return {
    id: p.id,
    title: p.title,
    journal,
    date,
    qualityScore: p.qualityScore ?? null,
    qualityTier: p.qualityTier ?? null,
    pubmedUrl: p.pubmedUrl,
    isOpenAccess: p.isOpenAccess,
    oaPdfUrl: p.oaPdfUrl,
    pdfEmailedAt: p.pdfEmailedAt,
    tagsRaw: p.tags ?? [],
    topics: p.topics ?? [],
    aiDigest: ai,
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
  topics: [],
  aiDigest: {
    summaryZh: "数据加载中（占位）。",
    background: "待生成（研究背景与动机）",
    method: "待生成（核心方法与创新点）",
    value: "待生成（临床与科研价值）",
  },
};

export function DailyPaperModule() {
  const [paper, setPaper] = React.useState<DailyPaperView>(fallbackPaper);
  const [items, setItems] = React.useState<DailyPaperView[]>([]);
  const [requiresLogin, setRequiresLogin] = React.useState(false);
  const [devBypassAuth, setDevBypassAuth] = React.useState(false);
  const [devBypassUserId, setDevBypassUserId] = React.useState<string | null>(null);
  const [devBypassSeedEmail, setDevBypassSeedEmail] = React.useState<string | null>(null);
  const [sendState, setSendState] = React.useState<Record<string, "idle" | "sending" | "sent" | "error">>({});
  const [lastSendMessage, setLastSendMessage] = React.useState<string | null>(null);
  const [selfCheckLoading, setSelfCheckLoading] = React.useState(false);
  const [selfCheckMessage, setSelfCheckMessage] = React.useState<string | null>(null);
  const [syncLoading, setSyncLoading] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);
  const [topicList, setTopicList] = React.useState<Array<{ slug: string; label: string }>>([]);
  const [selectedTopic, setSelectedTopic] = React.useState<string>("all");
  const [listPage, setListPage] = React.useState(1);
  const listPageSize = 6;

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
      const params = new URLSearchParams();
      if (selectedTopic !== "all") params.set("topic", selectedTopic);
      const res = await fetch(`/api/papers/feed${params.toString() ? `?${params.toString()}` : ""}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const json = (await res.json()) as FeedResponse;
      setRequiresLogin(Boolean(json.requiresLogin));
      setDevBypassAuth(Boolean(json.devBypassAuth));
      setDevBypassUserId(json.devBypassUserId ?? null);
      setDevBypassSeedEmail(json.devBypassSeedEmail ?? null);
      if (json?.featured?.title && json?.featured?.pubmedUrl) {
        setPaper(toDailyPaperView(json.featured));
      }
      setItems((json.items ?? []).map(toDailyPaperView));
      setListPage(1);
    } catch {
      return;
    }
  }, [getAccessToken, selectedTopic]);

  React.useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  React.useEffect(() => {
    async function loadTopics() {
      try {
        const res = await fetch("/api/research-topics", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as TopicListResponse;
        const list = (json.items ?? []).map((t) => ({
          slug: t.slug,
          label: t.name_zh || t.name_en || t.slug,
        }));
        setTopicList(list);
      } catch {
        return;
      }
    }
    void loadTopics();
  }, []);

  const handleSendPdf = React.useCallback(
    async (paperId: string) => {
      setSendState((prev) => ({ ...prev, [paperId]: "sending" }));
      try {
        const token = await getAccessToken();
        if (!token && !devBypassAuth) {
          setSendState((prev) => ({ ...prev, [paperId]: "error" }));
          return;
        }
        const res = await fetch("/api/send-pdf", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ paperId }),
        });
        const payload = (await res.json()) as SendApiResponse;
        if (!res.ok) {
          setLastSendMessage(payload.error ?? "发送失败，请重试");
          setSendState((prev) => ({ ...prev, [paperId]: "error" }));
          return;
        }
        setLastSendMessage(
          payload.emailedTo ? `发送成功：${payload.emailedTo}` : "发送成功",
        );
        setSendState((prev) => ({ ...prev, [paperId]: "sent" }));
      } catch {
        setLastSendMessage("发送失败，请重试");
        setSendState((prev) => ({ ...prev, [paperId]: "error" }));
      }
    },
    [devBypassAuth, getAccessToken],
  );

  const buttonLabel = (id: string, emailedAt: string | null) => {
    const state = sendState[id];
    if (state === "sending") return "发送中…";
    if (state === "sent" || emailedAt) return "已发送";
    if (state === "error") return "发送失败，重试";
    return "发送全文到我的邮箱";
  };

  const totalListPages = Math.max(1, Math.ceil(items.length / listPageSize));
  const visibleItems = items.slice(
    (listPage - 1) * listPageSize,
    (listPage - 1) * listPageSize + listPageSize,
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

      {topicList.length ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedTopic("all")}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              selectedTopic === "all"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            全部方向
          </button>
          {topicList.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => setSelectedTopic(t.slug)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                selectedTopic === t.slug
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {requiresLogin ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          研究方向订阅和邮件发送功能需登录后使用。{" "}
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
        <div className="flex flex-wrap gap-2">
          {paper.tagsRaw.slice(0, 3).map((t) => (
            <span
              key={t}
              className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md"
            >
              {t}
            </span>
          ))}
          {paper.topics.slice(0, 2).map((t) => (
            <span
              key={t.slug}
              className="text-[10px] uppercase font-bold text-teal-700 bg-teal-50 px-2 py-1 rounded-md"
            >
              {t.nameZh || t.nameEn || t.slug}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <button
          type="button"
          disabled={requiresLogin || !paper.isOpenAccess || sendState[paper.id] === "sending" || sendState[paper.id] === "sent" || Boolean(paper.pdfEmailedAt)}
          onClick={() => handleSendPdf(paper.id)}
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-800 transition-colors"
        >
          {buttonLabel(paper.id, paper.pdfEmailedAt)}
        </button>
        {requiresLogin ? (
          <p className="mt-2 text-xs text-slate-500">
            登录后可按你的订阅词个性化推送并发送全文。请先登录。
          </p>
        ) : null}
        {!requiresLogin && devBypassAuth ? (
          <p className="mt-2 text-xs text-amber-600">当前为开发免登录模式，仅用于本地测试。</p>
        ) : null}
        {lastSendMessage ? (
          <p className="mt-2 text-xs text-slate-600">{lastSendMessage}</p>
        ) : null}
        {!paper.isOpenAccess ? (
          <p className="mt-2 text-xs text-slate-500">当前文献非开放获取，暂不支持邮箱发送全文。</p>
        ) : null}
      </div>

      <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 flex-grow z-10">
        <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <div className="w-1.5 h-4 bg-teal-500 rounded-full"></div>
          AI Summary
        </h4>
        <p className="text-slate-700 text-sm leading-relaxed mb-6">
          {paper.aiDigest.summaryZh}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">
              研究背景 (Background)
            </div>
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <Stethoscope className="w-4 h-4 text-teal-600" />
              {paper.aiDigest.background}
            </div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">
              核心方法 (Method)
            </div>
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <Brain className="w-4 h-4 text-indigo-500" />
              {paper.aiDigest.method}
            </div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">
              临床价值 (Value)
            </div>
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <Dna className="w-4 h-4 text-blue-500" />
              {paper.aiDigest.value}
            </div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">
              摘要翻译 (Summary)
            </div>
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" />
              {paper.aiDigest.summaryZh}
            </div>
          </div>
        </div>
      </div>

      {items.length ? (
        <div className="mt-4 space-y-3">
          {visibleItems.map((it) => (
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
                </div>
                <button
                  type="button"
                  disabled={requiresLogin || !it.isOpenAccess || sendState[it.id] === "sending" || sendState[it.id] === "sent" || Boolean(it.pdfEmailedAt)}
                  onClick={() => handleSendPdf(it.id)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                >
                  {buttonLabel(it.id, it.pdfEmailedAt)}
                </button>
              </div>
            </div>
          ))}
          {totalListPages > 1 ? (
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                disabled={listPage <= 1}
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                上一页
              </button>
              <div className="text-xs text-slate-500">
                第 {listPage} / {totalListPages} 页（共 {items.length} 篇）
              </div>
              <button
                type="button"
                disabled={listPage >= totalListPages}
                onClick={() => setListPage((p) => Math.min(totalListPages, p + 1))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                下一页
              </button>
            </div>
          ) : null}
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
