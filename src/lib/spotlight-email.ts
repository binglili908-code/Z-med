import { cleanText, escapeHtml } from "@/lib/email-template-utils";
import { sendResendEmail } from "@/lib/resend-email";
import type { SpotlightPaper } from "@/lib/spotlight";

type SpotlightDigestTemplateOptions = {
  heading: string;
  intro: string;
  footer?: string;
};

type SendSpotlightDigestEmailParams = {
  to: string;
  subject: string;
  items: SpotlightPaper[];
  heading: string;
  intro: string;
  footer?: string;
};

function getBaseUrl() {
  const baseUrl =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://zlab-med.com";
  return baseUrl.replace(/\/+$/, "");
}

function buildTitleHtml(item: SpotlightPaper) {
  const titleZh = cleanText(item.title_zh);
  const titleEn = cleanText(item.title);
  if (titleZh && titleEn && titleZh !== titleEn) {
    return `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px;">${escapeHtml(titleZh)}</div>
        <div style="font-size:13px;color:#475569;margin-bottom:8px;">${escapeHtml(titleEn)}</div>
    `;
  }
  return `<div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">${escapeHtml(titleEn ?? "")}</div>`;
}

function buildAbstractHtml(item: SpotlightPaper) {
  const abstractZh = cleanText(item.abstract_zh ?? item.ai_analysis?.summary_zh);
  const abstractEn = cleanText(item.abstract);

  if (abstractZh && abstractEn && abstractZh !== abstractEn) {
    return `
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:10px 0 4px;">中文摘要</div>
        <div style="font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHtml(abstractZh)}</div>
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:12px 0 4px;">English Abstract</div>
        <div style="font-size:13px;line-height:1.7;color:#475569;white-space:pre-wrap;">${escapeHtml(abstractEn)}</div>
    `;
  }

  if (abstractZh) {
    return `
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:10px 0 4px;">中文摘要</div>
        <div style="font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHtml(abstractZh)}</div>
    `;
  }

  if (abstractEn) {
    return `
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:10px 0 4px;">English Abstract</div>
        <div style="font-size:13px;line-height:1.7;color:#475569;white-space:pre-wrap;">${escapeHtml(abstractEn)}</div>
    `;
  }

  return `<div style="font-size:13px;line-height:1.7;color:#64748b;">暂无摘要。</div>`;
}

function sourceTypeLabel(sourceType: SpotlightPaper["source_type"]) {
  switch (sourceType) {
    case "precision":
      return "精准匹配";
    case "trending":
      return "全局热点";
    case "serendipity":
      return "拓展推荐";
    default:
      return "精选推荐";
  }
}

export function buildSpotlightDigestHtml(
  items: SpotlightPaper[],
  options: SpotlightDigestTemplateOptions,
) {
  const logoUrl = `${getBaseUrl()}/api/brand/logo`;
  const rows = items
    .map(
      (item, index) => `
      <div style="margin-bottom:20px;padding:14px;border:1px solid #e2e8f0;border-radius:10px;">
        <div style="margin-bottom:6px;">
          <span style="display:inline-block;font-size:11px;color:#0f172a;background:#e2e8f0;border-radius:6px;padding:3px 8px;margin-right:6px;">#${index + 1}</span>
          <span style="display:inline-block;font-size:11px;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;border-radius:6px;padding:3px 8px;margin-right:6px;">${sourceTypeLabel(item.source_type)}</span>
          <span style="display:inline-block;font-size:11px;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;border-radius:6px;padding:3px 8px;">${(item.quality_tier ?? "").toUpperCase()}</span>
        </div>
        ${buildTitleHtml(item)}
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">${escapeHtml(item.journal)} · ${escapeHtml(item.publication_date ?? "N/A")}</div>
        <div style="margin-bottom:8px;"><a href="${escapeHtml(item.pubmed_url)}" target="_blank" rel="noreferrer">查看 PubMed 原文</a></div>
        ${buildAbstractHtml(item)}
      </div>
    `,
    )
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <div style="display:flex;align-items:center;margin-bottom:12px;">
        <img src="${logoUrl}" alt="Z-Lab" style="height:28px;margin-right:10px;border-radius:6px;" />
        <div style="font-size:18px;font-weight:800;color:#0f172a;">Z-Lab 医学前沿精选</div>
      </div>
      <h2 style="margin:0 0 8px 0;color:#0f172a;">${options.heading}</h2>
      <p style="color:#475569;margin:4px 0 16px 0;font-size:13px;">${options.intro}</p>
      ${rows}
      <div style="margin-top:16px;font-size:11px;color:#64748b;">${options.footer ?? "如需调整订阅偏好，请前往 Z-Lab 设置页面。"}</div>
    </div>
  `;
}

export function getDailySpotlightEmailSubject() {
  return "本周首页精选 7 篇文献（含中文摘要）";
}

export function getWeeklySpotlightEmailSubject(issueWeekStart: string) {
  return `本周首页精选 7 篇文献（${issueWeekStart}）`;
}

export async function sendSpotlightDigestEmail(params: SendSpotlightDigestEmailParams) {
  const html = buildSpotlightDigestHtml(params.items, {
    heading: params.heading,
    intro: params.intro,
    footer: params.footer,
  });

  return sendResendEmail({
    to: params.to,
    subject: params.subject,
    html,
  });
}
