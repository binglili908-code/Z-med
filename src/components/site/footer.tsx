import Link from "next/link";

import { Container } from "@/components/site/container";
import { Badge } from "@/components/ui/badge";

const socials = [
  { href: "#", label: "微信公众号" },
  { href: "#", label: "B站" },
  { href: "#", label: "小红书" },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white">
      <Container className="py-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Z-Lab 医疗 AI 开源情报站
            </div>
            <div className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
              免责声明：本站内容用于开源情报整理与科研交流；不构成医疗建议、诊断或治疗方案。请以权威机构与专业医生意见为准。
            </div>
            <div className="mt-4 text-xs text-slate-500">
              © {year} Z-Lab. All rights reserved.
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs font-medium text-slate-500">社交媒体矩阵</div>
            <div className="flex flex-wrap gap-2">
              {socials.map((s) => (
                <Link key={s.label} href={s.href} className="focus:outline-none">
                  <Badge className="cursor-pointer">{s.label}</Badge>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </footer>
  );
}
