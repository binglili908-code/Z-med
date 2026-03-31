import Link from "next/link";

import { ArrowRight, Zap } from "lucide-react";

import { Container } from "@/components/site/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function FeaturedContent() {
  return (
    <Container className="pb-14">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-slate-700" />
            0-Base Reproduction
          </CardTitle>
          <CardDescription>
            平台核心差异化：用可复用模板把高分医学 AI 论文复现变成“可执行任务”（占位）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 sm:grid-cols-[220px_1fr] sm:items-center">
            <div className="aspect-[16/10] w-full rounded-xl border border-slate-200 bg-white" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">环境配置</Badge>
                <Badge tone="brand">数据集</Badge>
                <Badge tone="brand">训练/评测</Badge>
              </div>
              <div className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
                如何零基础复现一篇 10 分医学 AI 论文
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                包含可复制的脚手架、资源清单与常见坑位排雷（占位描述）。
              </div>
              <div className="mt-5">
                <Link href="/tutorials">
                  <Button variant="secondary">
                    立即阅读
                    <ArrowRight className="h-4 w-4 opacity-80" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
