"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Clock, Sparkles } from "lucide-react";

import { buildRedirectTarget, buildSignInPath } from "@/lib/auth-navigation";
import { DEV_PANEL_EMAIL, isDevPanelEmail } from "@/lib/dev-admin";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

type FeedPaper = {
  id: string;
  title: string;
  title_zh?: string | null;
  journal: string;
  journal_if?: number | null;
  journal_jcr?: string | null;
  journal_cas_zone?: string | null;
  publication_date: string | null;
  abstract: string | null;
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
  page?: number;
  pageSize?: number;
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
  actor?: {
    mode?: "email" | "dev-bypass";
    email?: string | null;
    userId?: string | null;
  };
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

type WeeklyPushApiResponse = {
  ok?: boolean;
  error?: string;
  issueId?: string;
  weekStart?: string;
  weekEnd?: string;
  selectedCount?: number;
  sentCount?: number;
  skippedRepeatedUsers?: number;
  skippedNoMatchUsers?: number;
};

type WeeklySpotlightCronApiResponse = {
  ok?: boolean;
  error?: string;
  issueWeekStart?: string;
  sentCount?: number;
  failedCount?: number;
  skippedRepeatedUsers?: number;
  skippedProcessingUsers?: number;
  skippedFailedUsers?: number;
};

type SubscriptionNormalizationApiResponse = {
  ok?: boolean;
  error?: string;
  scannedCount?: number;
  normalizedCount?: number;
  failedCount?: number;
};

type DailyPaperView = {
  id: string;
  title: string;
  titleZh: string | null;
  journal: string;
  journalIf: number | null;
  journalJcr: string | null;
  journalCasZone: string | null;
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
  abstractEn: string | null,
  ai: Record<string, unknown> | null,
  fallbackDate: string,
) {
  if (abstractZh?.trim()) return abstractZh.trim();
  if (typeof ai?.summary_zh === "string" && ai.summary_zh.trim()) return ai.summary_zh.trim();
  if (abstractEn?.trim()) return abstractEn.trim();
  return `中文摘要待生成（文献发布日期 ${fallbackDate}）。`;
}

function toDailyPaperView(p: FeedPaper): DailyPaperView {
  const journal = p.journal ?? "PubMed";
  const date = parseDate(p.publication_date);
  const abstractZh = resolveAbstractZh(p.abstract_zh, p.abstract, p.ai_analysis, date);

  return {
    id: p.id,
    title: p.title,
    titleZh: p.title_zh?.trim() ? p.title_zh.trim() : null,
    journal,
    journalIf: typeof p.journal_if === "number" ? p.journal_if : null,
    journalJcr: p.journal_jcr?.trim() ? p.journal_jcr.trim() : null,
    journalCasZone: p.journal_cas_zone?.trim() ? p.journal_cas_zone.trim() : null,
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
  titleZh: null,
  journal: "PubMed",
  journalIf: null,
  journalJcr: null,
  journalCasZone: null,
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = React.useMemo(() => getBrowserSupabaseClient(), []);

  const [paper, setPaper] = React.useState<DailyPaperView>(fallbackPaper);
  const [items, setItems] = React.useState<DailyPaperView[]>([]);
  const [browseEnabled, setBrowseEnabled] = React.useState(false);
  const [browseItems, setBrowseItems] = React.useState<DailyPaperView[]>([]);
  const [browsePage, setBrowsePage] = React.useState(1);
  const [browseTotalPages, setBrowseTotalPages] = React.useState(1);
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [requiresLogin, setRequiresLogin] = React.useState(false);
  const [hasSubscription, setHasSubscription] = React.useState(false);
  const [currentUserEmail, setCurrentUserEmail] = React.useState<string | null>(null);
  const [devBypassAuth, setDevBypassAuth] = React.useState(false);
  const [devBypassUserId, setDevBypassUserId] = React.useState<string | null>(null);
  const [devBypassSeedEmail, setDevBypassSeedEmail] = React.useState<string | null>(null);
  const [canTranslate, setCanTranslate] = React.useState(false);
  const [digestSendState, setDigestSendState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [translateState, setTranslateState] = React.useState<Record<string, "idle" | "translating" | "done" | "error">>({});
  const [lastSendMessage, setLastSendMessage] = React.useState<string | null>(null);
  const [selfCheckLoading, setSelfCheckLoading] = React.useState(false);
  const [selfCheckMessage, setSelfCheckMessage] = React.useState<string | null>(null);
  const [syncLoading, setSyncLoading] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);
  const [weeklyPushLoading, setWeeklyPushLoading] = React.useState(false);
  const [weeklyPushMessage, setWeeklyPushMessage] = React.useState<string | null>(null);
  const [weeklySpotlightLoading, setWeeklySpotlightLoading] = React.useState(false);
  const [weeklySpotlightMessage, setWeeklySpotlightMessage] = React.useState<string | null>(null);
  const [subscriptionNormalizationLoading, setSubscriptionNormalizationLoading] = React.useState(false);
  const [subscriptionNormalizationMessage, setSubscriptionNormalizationMessage] = React.useState<string | null>(null);
  const [expandedSummaryIds, setExpandedSummaryIds] = React.useState<Record<string, boolean>>({});
  const authRedirect = React.useMemo(
    () => buildRedirectTarget(pathname, searchParams.toString()),
    [pathname, searchParams],
  );

  const getSessionInfo = React.useCallback(async () => {
    if (!supabase) {
      return { accessToken: null, email: null };
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      accessToken: session?.access_token ?? null,
      email: session?.user?.email ?? null,
    };
  }, [supabase]);

  const getAccessToken = React.useCallback(async () => {
    const { accessToken } = await getSessionInfo();
    return accessToken;
  }, [getSessionInfo]);

  React.useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setCurrentUserEmail(data.session?.user?.email ?? null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserEmail(session?.user?.email ?? null);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

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
      setBrowseEnabled(false);
      setBrowseItems([]);
      setBrowsePage(1);
      setBrowseTotalPages(1);
      setExpandedSummaryIds({});
      setDigestSendState("idle");
      setTranslateState({});
    } catch {
      return;
    }
  }, [getAccessToken]);

  const loadTranslateAvailability = React.useCallback(async () => {
    try {
      const token = await getAccessToken();
      setCanTranslate(Boolean(token));
    } catch {
      setCanTranslate(false);
    }
  }, [getAccessToken]);

  const loadBrowse = React.useCallback(
    async (page: number) => {
      setBrowseLoading(true);
      try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", "12");
        const res = await fetch(`/api/papers/feed?${params.toString()}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const json = (await res.json()) as FeedResponse;
        const rows = (json.papers ?? []).map(toDailyPaperView);
        const totalPages = Math.max(1, Math.ceil(Number(json.total ?? rows.length) / 12));
        setBrowseItems(rows);
        setBrowsePage(page);
        setBrowseTotalPages(totalPages);
      } catch {
        return;
      } finally {
        setBrowseLoading(false);
      }
    },
    [getAccessToken],
  );

  React.useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  React.useEffect(() => {
    void loadTranslateAvailability();
  }, [loadTranslateAvailability]);

  const showDevPanel = isDevPanelEmail(currentUserEmail);

  const handleSendSpotlight = React.useCallback(async () => {
    if (requiresLogin) {
      router.push(buildSignInPath(authRedirect));
      return;
    }

    setDigestSendState("sending");
    setLastSendMessage(null);
    try {
      const token = await getAccessToken();
      if (!token && !devBypassAuth) {
        router.push(buildSignInPath(authRedirect));
        return;
      }
      const res = await fetch("/api/send-spotlight-email", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        let payload: SendApiResponse | null = null;
        try {
          payload = (await res.json()) as SendApiResponse;
        } catch {
          payload = null;
        }
        setLastSendMessage(payload?.error ?? `发送失败（HTTP ${res.status}）`);
        setDigestSendState("error");
        return;
      }
      let payload: SendApiResponse | null = null;
      try {
        payload = (await res.json()) as SendApiResponse;
      } catch {
        payload = null;
      }
      setLastSendMessage(
        payload?.emailedTo
          ? `发送成功：${payload.emailedTo}（共 ${payload.count ?? 0} 篇）`
          : "发送成功",
      );
      setDigestSendState("sent");
    } catch {
      setLastSendMessage("请求异常：若邮箱已收到可忽略并刷新页面确认状态");
      setDigestSendState("error");
    }
  }, [authRedirect, devBypassAuth, getAccessToken, requiresLogin, router]);

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

  const formatIf = React.useCallback((v: number | null) => {
    if (v == null) return null;
    return Number(v).toFixed(1).replace(/\.0$/, "");
  }, []);

  const ifBadgeClass = React.useCallback((v: number | null) => {
    if (v == null) return "bg-slate-100 border-slate-300 text-slate-700";
    if (v >= 30) return "bg-amber-100 border-amber-300 text-amber-800";
    if (v >= 10) return "bg-blue-100 border-blue-300 text-blue-800";
    if (v >= 5) return "bg-emerald-100 border-emerald-300 text-emerald-800";
    return "bg-slate-100 border-slate-300 text-slate-700";
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
      const token = await getAccessToken();
      if (!token) {
        setSelfCheckMessage(`请先使用 ${DEV_PANEL_EMAIL} 登录后再执行自检。`);
        return;
      }
      const res = await fetch("/api/dev/self-check", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
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
  }, [getAccessToken]);

  const handleSyncNow = React.useCallback(async () => {
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setSyncMessage(`请先使用 ${DEV_PANEL_EMAIL} 登录后再执行同步。`);
        return;
      }
      const res = await fetch("/api/cron/pubmed-sync", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
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
  }, [getAccessToken, loadFeed]);

  const handleWeeklyPushNow = React.useCallback(async () => {
    setWeeklyPushLoading(true);
    setWeeklyPushMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setWeeklyPushMessage(`请先使用 ${DEV_PANEL_EMAIL} 登录后再触发 weekly-push。`);
        return;
      }
      const res = await fetch("/api/cron/weekly-push", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as WeeklyPushApiResponse;
      if (!res.ok || !payload.ok) {
        setWeeklyPushMessage(payload.error ?? "weekly-push 触发失败");
        return;
      }
      setWeeklyPushMessage(
        `weekly-push 已完成：周期 ${payload.weekStart ?? "未知"} ~ ${payload.weekEnd ?? "未知"}，入选 ${payload.selectedCount ?? 0} 篇，发送 ${payload.sentCount ?? 0} 人，跳过重复 ${payload.skippedRepeatedUsers ?? 0} 人，无匹配 ${payload.skippedNoMatchUsers ?? 0} 人。`,
      );
    } catch {
      setWeeklyPushMessage("weekly-push 请求失败");
    } finally {
      setWeeklyPushLoading(false);
    }
  }, [getAccessToken]);

  const handleWeeklySpotlightNow = React.useCallback(async () => {
    const token = await getAccessToken();
    const targetEmail = currentUserEmail ?? DEV_PANEL_EMAIL;
    if (!token) {
      setWeeklySpotlightMessage(`请先使用 ${DEV_PANEL_EMAIL} 登录后再触发首页精选周邮件。`);
      return;
    }
    setWeeklySpotlightLoading(true);
    setWeeklySpotlightMessage(null);
    try {
      const search = new URLSearchParams({
        email: targetEmail,
        limit: "1",
      });
      const res = await fetch(`/api/cron/weekly-spotlight-email?${search.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as WeeklySpotlightCronApiResponse;
      if (!res.ok || !payload.ok) {
        setWeeklySpotlightMessage(payload.error ?? "首页精选周邮件触发失败");
        return;
      }
      setWeeklySpotlightMessage(
        `首页精选周邮件已完成：周起始 ${payload.issueWeekStart ?? "未知"}，发送 ${payload.sentCount ?? 0} 人，跳过重复 ${payload.skippedRepeatedUsers ?? 0} 人，处理中 ${payload.skippedProcessingUsers ?? 0} 人，保留失败 ${payload.skippedFailedUsers ?? 0} 人，失败 ${payload.failedCount ?? 0} 人。`,
      );
    } catch {
      setWeeklySpotlightMessage("首页精选周邮件请求失败");
    } finally {
      setWeeklySpotlightLoading(false);
    }
  }, [currentUserEmail, getAccessToken]);

  const handleSubscriptionNormalizationNow = React.useCallback(async () => {
    setSubscriptionNormalizationLoading(true);
    setSubscriptionNormalizationMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setSubscriptionNormalizationMessage(`请先使用 ${DEV_PANEL_EMAIL} 登录后再标准化订阅偏好。`);
        return;
      }
      const res = await fetch("/api/cron/subscription-normalization?limit=10", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as SubscriptionNormalizationApiResponse;
      if (!res.ok || !payload.ok) {
        setSubscriptionNormalizationMessage(payload.error ?? "订阅偏好标准化失败");
        return;
      }
      setSubscriptionNormalizationMessage(
        `订阅偏好标准化完成：扫描 ${payload.scannedCount ?? 0} 个用户，成功 ${payload.normalizedCount ?? 0} 个，失败 ${payload.failedCount ?? 0} 个。`,
      );
    } catch {
      setSubscriptionNormalizationMessage("订阅偏好标准化请求失败");
    } finally {
      setSubscriptionNormalizationLoading(false);
    }
  }, [getAccessToken]);

  const handleExpandBrowse = React.useCallback(async () => {
    setBrowseEnabled(true);
    await loadBrowse(1);
  }, [loadBrowse]);

  const applyTranslatedResult = React.useCallback((paperId: string, titleZh: string, abstractZh: string) => {
    setPaper((prev) =>
      prev.id === paperId
        ? { ...prev, titleZh: titleZh || prev.titleZh, abstractZh: abstractZh || prev.abstractZh }
        : prev,
    );
    setItems((prev) =>
      prev.map((it) =>
        it.id === paperId ? { ...it, titleZh: titleZh || it.titleZh, abstractZh: abstractZh || it.abstractZh } : it,
      ),
    );
    setBrowseItems((prev) =>
      prev.map((it) =>
        it.id === paperId ? { ...it, titleZh: titleZh || it.titleZh, abstractZh: abstractZh || it.abstractZh } : it,
      ),
    );
  }, []);

  const handleTranslateWithMine = React.useCallback(
    async (paperId: string) => {
      const target =
        paper.id === paperId
          ? paper
          : items.find((x) => x.id === paperId) ?? browseItems.find((x) => x.id === paperId);
      if (target?.titleZh && target.abstractZh) {
        setLastSendMessage("该文献已有中文翻译，已直接展示。");
        setTranslateState((prev) => ({ ...prev, [paperId]: "done" }));
        return;
      }
      setTranslateState((prev) => ({ ...prev, [paperId]: "translating" }));
      try {
        const token = await getAccessToken();
        if (!token) {
          setTranslateState((prev) => ({ ...prev, [paperId]: "error" }));
          setLastSendMessage("请先登录后使用翻译功能。");
          return;
        }
        const res = await fetch(`/api/papers/${paperId}/translate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await res.json()) as {
          error?: string;
          title_zh?: string;
          abstract_zh?: string;
          fallback_to_english?: boolean;
          message?: string;
        };
        if (!res.ok) {
          setTranslateState((prev) => ({ ...prev, [paperId]: "error" }));
          setLastSendMessage(payload.error ?? "翻译失败");
          return;
        }
        applyTranslatedResult(paperId, payload.title_zh ?? "", payload.abstract_zh ?? "");
        setTranslateState((prev) => ({ ...prev, [paperId]: "done" }));
        setLastSendMessage(
          payload.message ?? (payload.fallback_to_english ? "模型不可用，已回退展示英文原文。" : "已完成中文翻译。"),
        );
      } catch {
        setTranslateState((prev) => ({ ...prev, [paperId]: "error" }));
        setLastSendMessage("翻译请求失败");
      }
    },
    [applyTranslatedResult, browseItems, getAccessToken, items, paper],
  );

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
          <Link
            href={buildSignInPath(authRedirect)}
            className="font-semibold text-slate-900 underline"
          >
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
        <div className="mb-3 flex flex-wrap gap-2">
          {paper.journalIf != null ? (
            <span className={`text-xs font-semibold border px-2 py-1 rounded-md ${ifBadgeClass(paper.journalIf)}`}>
              IF: {formatIf(paper.journalIf)}
            </span>
          ) : null}
          {paper.journalJcr ? (
            <span className="text-xs font-semibold border border-slate-300 bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
              {paper.journalJcr}
            </span>
          ) : null}
          {paper.journalCasZone ? (
            <span className="text-xs font-semibold border border-slate-300 bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
              {paper.journalCasZone}
            </span>
          ) : null}
        </div>
        <a
          href={paper.pubmedUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-2xl font-bold text-slate-900 leading-snug mb-2 hover:text-teal-700 transition-colors"
        >
          {paper.title}
        </a>
        {paper.titleZh ? (
          <div className="mb-2 text-sm font-medium text-slate-600">{paper.titleZh}</div>
        ) : null}
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
        {canTranslate ? (
          <button
            type="button"
            onClick={() => void handleTranslateWithMine(paper.id)}
            disabled={translateState[paper.id] === "translating"}
            className="ml-2 mt-1 rounded-lg border border-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            {translateState[paper.id] === "translating" ? "翻译中..." : "翻译为中文"}
          </button>
        ) : null}
      </div>

      <div className="mb-4">
        <button
          type="button"
          disabled={digestSendState === "sending" || digestSendState === "sent"}
          onClick={handleSendSpotlight}
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-800 transition-colors"
        >
          {requiresLogin ? "登录后发送到我的邮箱" : digestButtonLabel()}
        </button>
        {requiresLogin ? (
          <p className="mt-2 text-xs text-slate-500">
            登录后可按你的订阅词个性化推送并发送全文，点击按钮会先跳转登录。
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
                {it.titleZh ? (
                  <div className="mt-1 text-xs font-medium text-slate-600">{it.titleZh}</div>
                ) : null}
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
                {canTranslate ? (
                  <button
                    type="button"
                    onClick={() => void handleTranslateWithMine(it.id)}
                    disabled={translateState[it.id] === "translating"}
                    className="rounded-lg border border-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {translateState[it.id] === "translating" ? "翻译中..." : "翻译为中文"}
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {it.journalIf != null ? (
                  <span className={`text-[11px] font-semibold border px-2 py-1 rounded-md ${ifBadgeClass(it.journalIf)}`}>
                    IF: {formatIf(it.journalIf)}
                  </span>
                ) : null}
                {it.journalJcr ? (
                  <span className="text-[11px] font-semibold border border-slate-300 bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                    {it.journalJcr}
                  </span>
                ) : null}
                {it.journalCasZone ? (
                  <span className="text-[11px] font-semibold border border-slate-300 bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                    {it.journalCasZone}
                  </span>
                ) : null}
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

      <div className="mt-4">
        {!browseEnabled ? (
          <button
            type="button"
            onClick={handleExpandBrowse}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            查看更多文献
          </button>
        ) : null}
      </div>

      {browseEnabled ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900">更多上新文献</h4>
            <button
              type="button"
              onClick={() => setBrowseEnabled(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              收起
            </button>
          </div>
          {browseLoading ? (
            <div className="py-3 text-xs text-slate-500">加载中...</div>
          ) : (
            <div className="space-y-3">
              {browseItems.map((it) => (
                <div key={`browse-${it.id}`} className="rounded-xl border border-slate-200 bg-white p-3">
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
                      onClick={() => toggleSummary(`browse-${it.id}`)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {isSummaryExpanded(`browse-${it.id}`) ? "收起摘要" : "摘要"}
                    </button>
                    {canTranslate ? (
                      <button
                        type="button"
                        onClick={() => void handleTranslateWithMine(it.id)}
                        disabled={translateState[it.id] === "translating"}
                        className="rounded-lg border border-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {translateState[it.id] === "translating" ? "翻译中..." : "翻译为中文"}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {it.journalIf != null ? (
                      <span className={`text-[11px] font-semibold border px-2 py-1 rounded-md ${ifBadgeClass(it.journalIf)}`}>
                        IF: {formatIf(it.journalIf)}
                      </span>
                    ) : null}
                    {it.journalJcr ? (
                      <span className="text-[11px] font-semibold border border-slate-300 bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                        {it.journalJcr}
                      </span>
                    ) : null}
                    {it.journalCasZone ? (
                      <span className="text-[11px] font-semibold border border-slate-300 bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                        {it.journalCasZone}
                      </span>
                    ) : null}
                  </div>
                  {isSummaryExpanded(`browse-${it.id}`) ? (
                    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">
                      {it.abstractZh}
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  disabled={browsePage <= 1 || browseLoading}
                  onClick={() => void loadBrowse(Math.max(1, browsePage - 1))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                >
                  上一页
                </button>
                <div className="text-xs text-slate-500">
                  第 {browsePage} / {browseTotalPages} 页
                </div>
                <button
                  type="button"
                  disabled={browsePage >= browseTotalPages || browseLoading}
                  onClick={() => void loadBrowse(Math.min(browseTotalPages, browsePage + 1))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {showDevPanel ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="font-semibold">开发工具小面板</div>
          <div className="mt-1">当前登录邮箱：{currentUserEmail ?? "未登录"}</div>
          <div className="mt-1">授权邮箱：{DEV_PANEL_EMAIL}</div>
          <div className="mt-1">免登录开关：{devBypassAuth ? "已开启" : "未开启"}</div>
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
          <div className="mt-2">
            <button
              type="button"
              onClick={handleWeeklyPushNow}
              disabled={weeklyPushLoading}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-amber-100"
            >
              {weeklyPushLoading ? "weekly-push 执行中…" : "一键触发 weekly-push"}
            </button>
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={handleWeeklySpotlightNow}
              disabled={weeklySpotlightLoading}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-amber-100"
            >
              {weeklySpotlightLoading ? "首页精选周邮件执行中…" : "一键触发首页精选周邮件"}
            </button>
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={handleSubscriptionNormalizationNow}
              disabled={subscriptionNormalizationLoading}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-amber-100"
            >
              {subscriptionNormalizationLoading ? "订阅偏好标准化中…" : "一键标准化订阅偏好"}
            </button>
          </div>
          <div className="mt-2">{selfCheckMessage ?? "点击按钮检查用户解析、OA文献与邮件配置。"}</div>
          <div className="mt-1">{syncMessage ?? "点击按钮触发同步任务并自动刷新文献列表。"}</div>
          <div className="mt-1">{weeklyPushMessage ?? "适合无命令行场景，点击后直接显示周推送执行结果。"}</div>
          <div className="mt-1">{weeklySpotlightMessage ?? "首页精选周邮件默认仅投递当前授权邮箱，便于手动验收。"}</div>
          <div className="mt-1">{subscriptionNormalizationMessage ?? "订阅偏好标准化会把旧用户的简写、拼写错误和英文词扩展成更适合匹配的词。"}</div>
        </div>
      ) : null}
    </div>
  );
}
