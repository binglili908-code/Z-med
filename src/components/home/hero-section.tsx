import Link from "next/link";

import { ArrowRight, BookOpen, CalendarDays } from "lucide-react";

import { Container } from "@/components/site/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function HeroSection() {
  return (
    <Container className="pt-10">
      <Card className="overflow-hidden">
        <CardContent className="relative p-8 sm:p-10">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-white" />
          <div className="relative">
            <div className="text-xs font-medium tracking-wide text-slate-500">
              Open Intelligence · Research Workbench
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              聚焦医疗 AI × 生信 × 计算机视觉的开源赋能与科研情报平台
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              用结构化时间轴、可复用的复现模板与精选开源项目，帮你更快定位机会、缩短从论文到实验的路径。
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/conference-radar">
                <Button variant="primary" className="w-full sm:w-auto">
                  <CalendarDays className="h-4 w-4" />
                  查看最新顶会时间
                  <ArrowRight className="h-4 w-4 opacity-80" />
                </Button>
              </Link>
              <Link href="/tutorials">
                <Button variant="secondary" className="w-full sm:w-auto">
                  <BookOpen className="h-4 w-4" />
                  浏览 10 分论文复现教程
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
