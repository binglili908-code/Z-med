import { AlertCircle, CalendarClock } from "lucide-react";

import { Container } from "@/components/site/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const items = [
  {
    name: "MICCAI 2026",
    tag: "Conference",
    date: "2026-03-20",
    note: "截稿提醒（占位）",
    tone: "brand" as const,
  },
  {
    name: "IEEE TMI",
    tag: "Journal",
    date: "Rolling",
    note: "持续投稿（占位）",
    tone: "neutral" as const,
  },
  {
    name: "CVPR (Medical Track)",
    tag: "Conference",
    date: "2026-11-01",
    note: "预警窗口（占位）",
    tone: "neutral" as const,
  },
] as const;

export function TimelinePreview() {
  return (
    <Container className="py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-slate-700" />
            会议与期刊时间轴预览
          </CardTitle>
          <CardDescription>
            工具占位：后续接入数据源后，可支持筛选、订阅与多时区提醒。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative ml-2 border-l border-slate-200">
            {items.map((it) => (
              <li key={it.name} className="relative pl-6 pb-6 last:pb-0">
                <span className="absolute left-[-5px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-600 ring-4 ring-white" />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {it.name}
                      </div>
                      <Badge tone={it.tone}>{it.tag}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {it.note}
                    </div>
                  </div>
                  <div className="text-sm font-medium text-slate-700">
                    {it.date}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </Container>
  );
}
