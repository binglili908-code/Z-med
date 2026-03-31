import Link from "next/link";

import { ArrowRight, FileText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const featured = {
  title:
    "Foundation model for multimodal clinical reasoning improves triage and reporting (占位标题)",
  venue: "Nature Medicine",
  date: "Today",
  abstract:
    "摘要占位：这篇工作提出了一个面向临床多模态（影像+病历）推理的统一框架，并在多中心数据上验证其可迁移性与安全性。",
  ai: {
    clinicalUtility:
      "面向急诊分诊与报告生成的辅助决策；对高负荷科室具有潜在效率收益（占位）",
    algorithmType: "Multi-modal LLM + Retrieval + Calibration（占位）",
    dataSize: "Imaging: 1.2M / EHR: 3.4M / Centers: 12（占位）",
  },
} as const;

const more = [
  {
    venue: "arXiv",
    title: "Promptable pathology foundation model for WSI segmentation (占位)",
    tag: "Pathology",
  },
  {
    venue: "IEEE TMI",
    title: "Self-supervised CT reconstruction for low-dose protocols (占位)",
    tag: "Imaging",
  },
  {
    venue: "Radiology",
    title: "Robust lesion detection across scanners via domain generalization (占位)",
    tag: "CV",
  },
] as const;

export function DailyLiteratureFeed() {
  return (
    <section className="space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-[0.18em] text-slate-500">
          TODAY&apos;S LITERATURE FEED &amp; AI SUMMARIES
        </div>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          每日文献与 AI 总结
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          将论文要点结构化为可直接决策的信息：临床实用性、算法类型与数据规模等（占位说明）。
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <FileText className="h-4 w-4 text-slate-700" />
            FEATURED DAILY PAPER
            <Badge className="ml-auto">{featured.venue}</Badge>
            <Badge tone="brand">{featured.date}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="text-base font-semibold leading-7 text-slate-900">
            {featured.title}
          </div>
          <div className="mt-3 text-sm leading-6 text-slate-600">
            {featured.abstract}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-brand-700" />
              AI SUMMARY
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Clinical Utility
                </dt>
                <dd className="mt-2 text-sm leading-6 text-slate-800">
                  {featured.ai.clinicalUtility}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Algorithm Type
                </dt>
                <dd className="mt-2 text-sm leading-6 text-slate-800">
                  {featured.ai.algorithmType}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">Data Size</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-800">
                  {featured.ai.dataSize}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Badge tone="brand">Clinical</Badge>
                <Badge tone="brand">Multimodal</Badge>
                <Badge>Safety（占位）</Badge>
              </div>
              <Link href="/literature-trends">
                <Button variant="secondary">
                  View AI Summary
                  <ArrowRight className="h-4 w-4 opacity-80" />
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {more.map((p) => (
          <Card key={p.title} className="hover:border-slate-300">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{p.venue}</Badge>
                    <Badge tone="brand">{p.tag}</Badge>
                  </div>
                  <div className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-900">
                    {p.title}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Link href="/literature-trends">
                  <Button variant="ghost" className="px-0">
                    View AI Summary
                    <ArrowRight className="h-4 w-4 opacity-80" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
