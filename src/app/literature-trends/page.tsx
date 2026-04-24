import { Suspense } from "react";

import { LiteratureSearchPage } from "@/components/literature/literature-search-page";

export default function LiteratureTrendsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">文献库加载中...</div>}>
      <LiteratureSearchPage />
    </Suspense>
  );
}
