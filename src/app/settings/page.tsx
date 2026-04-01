"use client";

import * as React from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

type TopicItem = {
  id: string;
  slug: string;
  name_zh: string | null;
  name_en: string | null;
};

type TopicListResponse = {
  items?: TopicItem[];
};

type UserSubscription = {
  topic_slugs: string[];
  keywords: string[];
  top_journals_only: boolean;
  min_score?: number;
};

export default function SettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState<string | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [topics, setTopics] = React.useState<TopicItem[]>([]);
  const [topicSlugs, setTopicSlugs] = React.useState<string[]>([]);
  const [keywords, setKeywords] = React.useState<string[]>([]);
  const [keywordInput, setKeywordInput] = React.useState("");
  const [topJournalsOnly, setTopJournalsOnly] = React.useState(false);
  const [minScore, setMinScore] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const supabase = React.useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    return createClient(url, anon);
  }, []);

  React.useEffect(() => {
    async function init() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setEmail(session?.user?.email ?? null);
      setToken(session?.access_token ?? null);
      if (session?.access_token) {
        try {
          const [topicRes, subRes] = await Promise.all([
            fetch("/api/research-topics", { cache: "no-store" }),
            fetch("/api/user/subscription", {
              cache: "no-store",
              headers: { Authorization: `Bearer ${session.access_token}` },
            }),
          ]);
          if (topicRes.ok) {
            const topicJson = (await topicRes.json()) as TopicListResponse;
            setTopics(topicJson.items ?? []);
          }
          if (subRes.ok) {
            const subJson = (await subRes.json()) as UserSubscription;
            setTopicSlugs(subJson.topic_slugs ?? []);
            setKeywords(subJson.keywords ?? []);
            setTopJournalsOnly(Boolean(subJson.top_journals_only));
            setMinScore(Number(subJson.min_score ?? 0));
          }
        } catch {
          setMessage("订阅配置加载失败，请刷新后重试。");
        }
      }
      setLoading(false);
    }
    void init();
  }, [supabase]);

  const addKeyword = React.useCallback(() => {
    const value = keywordInput.trim();
    if (!value) return;
    setKeywords((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setKeywordInput("");
  }, [keywordInput]);

  const removeKeyword = React.useCallback((value: string) => {
    setKeywords((prev) => prev.filter((k) => k !== value));
  }, []);

  const toggleTopic = React.useCallback((slug: string) => {
    setTopicSlugs((prev) =>
      prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug],
    );
  }, []);

  const saveSubscription = React.useCallback(async () => {
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/user/subscription", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic_slugs: topicSlugs,
          keywords,
          top_journals_only: topJournalsOnly,
          min_score: minScore,
        } satisfies UserSubscription),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(payload.error ?? "保存失败，请重试。");
        return;
      }
      setMessage("订阅偏好已保存。");
    } catch {
      setMessage("保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }, [keywords, minScore, token, topJournalsOnly, topicSlugs]);

  const refreshRecommendations = React.useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/user/recommendations/refresh", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await res.json()) as { error?: string; count?: number };
      if (!res.ok) {
        setMessage(payload.error ?? "推荐刷新失败，请重试。");
        return;
      }
      setMessage(`今日推荐已刷新，共生成 ${payload.count ?? 0} 条。`);
    } catch {
      setMessage("推荐刷新失败，请重试。");
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-6 pt-10 pb-20">
        <p className="text-slate-500">加载中...</p>
      </main>
    );
  }

  if (!email) {
    return (
      <main className="max-w-4xl mx-auto px-6 pt-10 pb-20">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-4 text-slate-600">请先登录后再访问个人设置。</p>
        <Link href="/signin" className="mt-4 inline-block text-sm font-semibold text-slate-900 underline">
          前往登录
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-6 pt-10 pb-20">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Settings</h1>
      <p className="mt-3 text-slate-600">当前登录账号：{email}</p>
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-bold text-slate-900">订阅偏好</h2>
        <p className="mt-2 text-sm text-slate-600">
          选择你关注的研究方向，并补充关键词，系统将优先展示相关文献。
        </p>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">研究方向（可多选）</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {topics.map((topic) => {
              const checked = topicSlugs.includes(topic.slug);
              const label = topic.name_zh || topic.name_en || topic.slug;
              return (
                <label
                  key={topic.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                    checked
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTopic(topic.slug)}
                    className="h-4 w-4"
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">自定义关键词</h3>
          <div className="mt-3 flex gap-2">
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="输入关键词后回车添加"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
            <button
              type="button"
              onClick={addKeyword}
              className="rounded-lg border border-slate-900 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              添加
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => removeKeyword(word)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                {word} ×
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">仅看顶刊</p>
            <p className="text-xs text-slate-500">开启后优先限制在 Top/Core 质量分层文献</p>
          </div>
          <button
            type="button"
            onClick={() => setTopJournalsOnly((v) => !v)}
            className={`relative h-7 w-12 rounded-full transition-colors ${
              topJournalsOnly ? "bg-slate-900" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                topJournalsOnly ? "right-1" : "left-1"
              }`}
            />
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={saveSubscription}
            disabled={saving}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存订阅偏好"}
          </button>
          <button
            type="button"
            onClick={refreshRecommendations}
            disabled={refreshing}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {refreshing ? "刷新中..." : "立即生成今日推荐"}
          </button>
          {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
        </div>
      </section>
    </main>
  );
}
