import { cleanText, escapeHtml } from "@/lib/email-template-utils";
import type { WeeklyPushCandidatePaper } from "@/server/repositories/weekly-push";

export type WeeklyPushDigestPaper = WeeklyPushCandidatePaper & {
  source_type?: "precision" | "serendipity";
  recommendation_reason?: string | null;
};

function getBaseUrl() {
  const baseUrl =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://zlab-med.com";
  return baseUrl.replace(/\/+$/, "");
}

function getAiSummaryZh(paper: WeeklyPushCandidatePaper) {
  const summary = paper.ai_analysis?.summary_zh;
  return typeof summary === "string" ? summary : null;
}

function buildPaperTitleHtml(paper: WeeklyPushDigestPaper) {
  const titleZh = cleanText(paper.title_zh);
  const titleEn = cleanText(paper.title);
  if (titleZh && titleEn && titleZh !== titleEn) {
    return `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px;">${escapeHtml(titleZh)}</div>
        <div style="font-size:13px;color:#475569;margin-bottom:8px;">${escapeHtml(titleEn)}</div>
    `;
  }
  return `<div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">${escapeHtml(titleEn ?? "")}</div>`;
}

function buildPaperAbstractHtml(paper: WeeklyPushDigestPaper) {
  const abstractZh = cleanText(paper.abstract_zh ?? getAiSummaryZh(paper));
  const abstractEn = cleanText(paper.abstract);
  if (abstractZh && abstractEn && abstractZh !== abstractEn) {
    return `
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:10px 0 4px;">\u4e2d\u6587\u6458\u8981</div>
        <div style="font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHtml(abstractZh)}</div>
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:12px 0 4px;">English Abstract</div>
        <div style="font-size:13px;line-height:1.7;color:#475569;white-space:pre-wrap;">${escapeHtml(abstractEn)}</div>
    `;
  }
  if (abstractZh) {
    return `
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:10px 0 4px;">\u4e2d\u6587\u6458\u8981</div>
        <div style="font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHtml(abstractZh)}</div>
    `;
  }
  if (abstractEn) {
    return `
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin:10px 0 4px;">English Abstract</div>
        <div style="font-size:13px;line-height:1.7;color:#475569;white-space:pre-wrap;">${escapeHtml(abstractEn)}</div>
    `;
  }
  return `<div style="font-size:13px;line-height:1.7;color:#64748b;">\u6682\u65e0\u6458\u8981</div>`;
}

function sourceTypeLabel(sourceType: WeeklyPushDigestPaper["source_type"]) {
  if (sourceType === "serendipity") return "\u4e3b\u9898\u5907\u9009";
  return "\u7cbe\u51c6\u5339\u914d";
}

function qualityLabel(paper: WeeklyPushDigestPaper) {
  const tier = cleanText(paper.quality_tier)?.toUpperCase();
  return tier || "\u7cbe\u9009";
}

function buildMetaHtml(paper: WeeklyPushDigestPaper) {
  const journal = escapeHtml(paper.journal ?? "PubMed");
  const date = escapeHtml(paper.publication_date ?? "N/A");
  return `${journal} &middot; ${date}`;
}

export function buildWeeklyPushDigestHtml(papers: WeeklyPushDigestPaper[]) {
  const logoUrl = `${getBaseUrl()}/api/brand/logo`;
  const list = papers
    .map(
      (paper, index) => `
      <div style="margin-bottom:20px;padding:14px;border:1px solid #e2e8f0;border-radius:10px;">
        <div style="margin-bottom:6px;">
          <span style="display:inline-block;font-size:11px;color:#0f172a;background:#e2e8f0;border-radius:6px;padding:3px 8px;margin-right:6px;">#${index + 1}</span>
          <span style="display:inline-block;font-size:11px;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;border-radius:6px;padding:3px 8px;margin-right:6px;">${sourceTypeLabel(paper.source_type)}</span>
          <span style="display:inline-block;font-size:11px;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;border-radius:6px;padding:3px 8px;">${escapeHtml(qualityLabel(paper))}</span>
        </div>
        ${buildPaperTitleHtml(paper)}
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">${buildMetaHtml(paper)}</div>
        ${
          paper.recommendation_reason
            ? `<div style="font-size:12px;color:#64748b;margin-bottom:8px;">${escapeHtml(paper.recommendation_reason)}</div>`
            : ""
        }
        <div style="margin-bottom:8px;"><a href="${escapeHtml(paper.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/")}" target="_blank" rel="noreferrer">\u67e5\u770b PubMed \u539f\u6587</a></div>
        ${buildPaperAbstractHtml(paper)}
      </div>`,
    )
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <div style="display:flex;align-items:center;margin-bottom:12px;">
        <img src="${logoUrl}" alt="Z-Lab" style="height:28px;margin-right:10px;border-radius:6px;" />
        <div style="font-size:18px;font-weight:800;color:#0f172a;">Z-Lab \u533b\u5b66\u524d\u6cbf\u7cbe\u9009</div>
      </div>
      <h2 style="margin:0 0 8px 0;color:#0f172a;">\u672c\u5468 AI+\u533b\u5b66\u7cbe\u9009\u6587\u732e</h2>
      <p style="color:#475569;margin:4px 0 16px 0;font-size:13px;">\u4ee5\u4e0b\u6587\u732e\u4f18\u5148\u5339\u914d\u60a8\u7684\u671f\u520a\u548c\u5173\u952e\u8bcd\u8ba2\u9605\u3002\u5982\u679c\u672c\u5468\u7cbe\u786e\u5339\u914d\u4e0d\u8db3\uff0c\u4f1a\u8865\u5145\u4e0e\u7814\u7a76\u65b9\u5411\u5f3a\u76f8\u5173\u7684\u4e3b\u9898\u5907\u9009\u3002</p>
      ${list}
      <div style="margin-top:16px;font-size:11px;color:#64748b;">\u5982\u9700\u8c03\u6574\u8ba2\u9605\u504f\u597d\uff0c\u8bf7\u524d\u5f80 Z-Lab \u8bbe\u7f6e\u9875\u9762\u3002</div>
    </div>
  `;
}

export function getWeeklyPushEmailSubject(summaryStart: string, summaryEnd: string) {
  return `\u6bcf\u5468 AI+\u533b\u5b66\u7cbe\u9009\u6587\u732e\uff08${summaryStart} ~ ${summaryEnd}\uff09`;
}
