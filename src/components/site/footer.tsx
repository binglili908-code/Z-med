import Image from "next/image";

import { Container } from "@/components/site/container";

import communityQr from "../../../images/社群二维码.jpg";
import officialAccountQr from "../../../images/智医研公众号二维码.jpg";
import zlabLogo from "../../../images/zlab-logo.jpg";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white">
      <Container className="py-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex max-w-2xl gap-4">
            <Image
              src={zlabLogo}
              alt="智医研 Z-Lab logo"
              className="h-16 w-16 shrink-0 rounded-2xl border border-slate-200 object-cover"
              priority={false}
            />
            <div>
              <div className="text-sm font-semibold tracking-tight">
                Z-Lab 医疗 AI 开源情报站
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                聚焦 AI 医疗文献检索、评分与订阅推送，服务医学科研交流与前沿信息整理。
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                免责声明：本站内容用于开源情报整理与科研交流；不构成医疗建议、诊断或治疗方案。请以权威机构与专业医生意见为准。
              </div>
              <div className="mt-4 text-xs text-slate-500">
                © {year} Z-Lab. All rights reserved.
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">公众号</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                扫码关注智医研，获取平台更新。
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2">
                <Image
                  src={officialAccountQr}
                  alt="智医研公众号二维码"
                  className="h-32 w-32 object-contain"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
              <div className="text-sm font-semibold text-slate-900">社群反馈</div>
              <div className="mt-1 text-xs leading-5 text-slate-600">
                如果网站遇到什么问题，敬请扫码进群反馈。
              </div>
              <div className="mt-3 rounded-xl border border-teal-200 bg-white p-2">
                <Image
                  src={communityQr}
                  alt="智医研社群二维码"
                  className="h-32 w-32 object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      </Container>
    </footer>
  );
}
