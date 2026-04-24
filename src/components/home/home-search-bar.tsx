"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function HomeSearchBar() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const onSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const q = query.trim();
      router.push(q ? `/literature-trends?q=${encodeURIComponent(q)}` : "/literature-trends");
    },
    [query, router],
  );

  return (
    <form onSubmit={onSubmit} className="mt-6 max-w-3xl">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索疾病、模型、任务、期刊或关键词，如 multimodal pathology"
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          搜索首页/文献库
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">支持标题、摘要、期刊、关键词与 MeSH 词检索。</p>
    </form>
  );
}
