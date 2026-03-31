import Link from "next/link";

import { BrainCircuit, Camera, Stethoscope, Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const lessons = [
  {
    title: "What is a 'Model' anyway? Simply Explained",
    subtitle: "模型到底是什么？大白话解释（占位）",
    level: "BEGINNER",
    format: "Reading · 6 min",
    icon: BrainCircuit,
  },
  {
    title: "AI + Imaging: How does it 'see' a lesion?",
    subtitle: "AI 看影像是怎么“看见”病灶的？（占位）",
    level: "BEGINNER",
    format: "Video · 8 min",
    icon: Camera,
  },
  {
    title: "From data to decision: where can bias happen?",
    subtitle: "从数据到决策：偏差可能发生在哪？（占位）",
    level: "BEGINNER",
    format: "Reading · 7 min",
    icon: Stethoscope,
  },
] as const;

export function AIDoctorsCorner() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-teal-100 bg-gradient-to-r from-teal-50 to-white">
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-teal-700" />
          AI DOCTOR&apos;S CORNER
          <Badge tone="teal" className="ml-auto">
            Friendly Path
          </Badge>
        </CardTitle>
        <div className="mt-1 text-sm text-slate-600">
          面向不懂 AI 的临床医生：更亲和的表达、更清晰的学习路径（占位说明）。
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {lessons.map((l) => (
            <div
              key={l.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100">
                  <l.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-6 text-slate-900">
                    {l.title}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">
                    {l.subtitle}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone="teal">{l.level}</Badge>
                <Badge className="text-slate-500">
                  {l.format.includes("Video") ? (
                    <span className="inline-flex items-center gap-1">
                      <Video className="h-3.5 w-3.5" />
                      {l.format}
                    </span>
                  ) : (
                    l.format
                  )}
                </Badge>
              </div>

              <div className="mt-4">
                <Link href="/tutorials">
                  <Button variant="secondary" className="w-full">
                    Start Learning
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
