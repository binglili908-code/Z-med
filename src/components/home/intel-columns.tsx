import { Github, Star } from "lucide-react";

import { Container } from "@/components/site/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const papers = [
  {
    venue: "Nature Medicine",
    title: "Multi-modal foundation model for clinical imaging and EHR (占位标题)",
    tags: ["医疗大模型", "多模态", "临床落地"],
  },
  {
    venue: "arXiv",
    title: "Weakly-supervised pathology segmentation with prompt learning (占位标题)",
    tags: ["病理", "弱监督", "Prompt"],
  },
  {
    venue: "Radiology",
    title: "Self-supervised representation learning for low-dose CT (占位标题)",
    tags: ["影像", "自监督", "CT"],
  },
] as const;

const repos = [
  {
    name: "Med-LLM-Toolkit",
    desc: "医学生成式模型评测与微调工具链（占位简介）",
    stars: "12.4k",
    lang: "Python",
  },
  {
    name: "ClinVision",
    desc: "临床图像-文本对齐与检索基线（占位简介）",
    stars: "6.8k",
    lang: "TypeScript",
  },
  {
    name: "BioInfo-Agents",
    desc: "生信流程与知识检索的 Agent 工作台（占位简介）",
    stars: "3.1k",
    lang: "Python",
  },
] as const;

export function IntelColumns() {
  return (
    <Container className="pb-10">
      <Card>
        <CardHeader>
          <CardTitle>分栏情报区</CardTitle>
          <CardDescription>
            列表/卡片占位：后续可接入爬虫、RSS、API 或内部标注数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8 lg:grid-cols-2">
          <section>
            <div className="text-sm font-semibold text-slate-900">
              前沿文献风向标
            </div>
            <div className="mt-4 space-y-4">
              {papers.map((p) => (
                <div
                  key={p.title}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{p.venue}</Badge>
                    {p.tags.slice(0, 2).map((t) => (
                      <Badge key={t} tone="brand">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 text-sm font-medium leading-6 text-slate-900">
                    {p.title}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Github className="h-4 w-4 text-slate-700" />
              GitHub 医疗大模型精选
            </div>
            <div className="mt-4 space-y-4">
              {repos.map((r) => (
                <div
                  key={r.name}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {r.name}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-slate-600">
                        {r.desc}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-medium text-slate-600">
                      <Star className="h-4 w-4 text-amber-500" />
                      {r.stars}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{r.lang}</Badge>
                    <Badge className="text-slate-500">精选（占位）</Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </CardContent>
      </Card>
    </Container>
  );
}
