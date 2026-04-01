"use client";

import * as React from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

type JournalItem = {
  id: string;
  journal_name: string | null;
  aliases: string[] | null;
  tier: string | null;
  weight: number | null;
  is_active: boolean | null;
};

type JournalListResponse = {
  items?: JournalItem[];
};

type UserSubscription = {
  journal_ids: string[];
  custom_journals: string[];
  keywords: string[];
  top_journals_only: boolean;
};

export default function SettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState<string | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [journals, setJournals] = React.useState<JournalItem[]>([]);
  const [selectedJournalIds, setSelectedJournalIds] = React.useState<string[]>([]);
  const [customJournals, setCustomJournals] = React.useState<string[]>([]);
  const [customJournalInput, setCustomJournalInput] = React.useState("");
  const [keywords, setKeywords] = React.useState<string[]>([]);
  const [keywordInput, setKeywordInput] = React.useState("");
  const [topJournalsOnly, setTopJournalsOnly] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
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
          const [journalRes, subRes] = await Promise.all([
            fetch("/api/journal-quality", { cache: "no-store" }),
            fetch("/api/user/subscription", {
              cache: "no-store",
              headers: { Authorization: `Bearer ${session.access_token}` },
            }),
          ]);
          if (journalRes.ok) {
            const journalJson = (await journalRes.json()) as JournalListResponse;
            setJournals((journalJson.items ?? []).filter((item) => item.is_active !== false));
          }
          if (subRes.ok) {
            const subJson = (await subRes.json()) as UserSubscription;
            setSelectedJournalIds(subJson.journal_ids ?? []);
            setCustomJournals(subJson.custom_journals ?? []);
            setKeywords(subJson.keywords ?? []);
            setTopJournalsOnly(Boolean(subJson.top_journals_only));
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

  const addCustomJournal = React.useCallback(() => {
    const value = customJournalInput.trim();
    if (!value) return;
    setCustomJournals((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setCustomJournalInput("");
  }, [customJournalInput]);

  const removeCustomJournal = React.useCallback((value: string) => {
    setCustomJournals((prev) => prev.filter((name) => name !== value));
  }, []);

  const toggleJournal = React.useCallback((journalId: string) => {
    setSelectedJournalIds((prev) =>
      prev.includes(journalId) ? prev.filter((id) => id !== journalId) : [...prev, journalId],
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
          journal_ids: selectedJournalIds,
          custom_journals: customJournals,
          keywords,
          top_journals_only: topJournalsOnly,
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
  }, [customJournals, keywords, selectedJournalIds, token, topJournalsOnly]);

  const groupedJournals = React.useMemo(() => {
    const top = journals.filter((j) => (j.tier ?? "").toLowerCase() === "top");
    const core = journals.filter((j) => (j.tier ?? "").toLowerCase() === "core");
    const emerging = journals.filter((j) => (j.tier ?? "").toLowerCase() === "emerging");
    return { top, core, emerging };
  }, [journals]);

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
        <p className="mt-2 text-sm text-slate-600">选择期刊并设置关键词，系统将按期刊与关键词联合筛选文献。</p>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">期刊选择</h3>
          <div className="mt-3 space-y-5">
            {[{ key: "top", label: "Top Tier", style: "text-amber-700 border-amber-300 bg-amber-50", list: groupedJournals.top },
              { key: "core", label: "Core Tier", style: "text-blue-700 border-blue-300 bg-blue-50", list: groupedJournals.core },
              { key: "emerging", label: "Emerging Tier", style: "text-slate-700 border-slate-300 bg-slate-50", list: groupedJournals.emerging }].map((group) => (
              <div key={group.key}>
                <div className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${group.style}`}>
                  {group.label}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.list.map((journal) => {
                    const checked = selectedJournalIds.includes(journal.id);
                    const aliasText = (journal.aliases ?? []).slice(0, 2).join(" / ");
                    return (
                      <label
                        key={journal.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                          checked
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-300 bg-white text-slate-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleJournal(journal.id)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>
                          <span className="block font-semibold">{journal.journal_name || "Unknown Journal"}</span>
                          {aliasText ? <span className="block text-xs opacity-80">{aliasText}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">添加其他期刊</h3>
          <div className="mt-3 flex gap-2">
            <input
              value={customJournalInput}
              onChange={(e) => setCustomJournalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomJournal();
                }
              }}
              placeholder="输入期刊名后回车添加"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
            <button
              type="button"
              onClick={addCustomJournal}
              className="rounded-lg border border-slate-900 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              添加
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {customJournals.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => removeCustomJournal(name)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                {name} ×
              </button>
            ))}
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

        <div className="mt-6">
          <button
            type="button"
            onClick={saveSubscription}
            disabled={saving}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存订阅偏好"}
          </button>
          {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
        </div>
      </section>
    </main>
  );
}
