import { startOfIsoWeek, toDateString } from "@/lib/iso-week";
import { createResendEmailSender } from "@/lib/resend-email";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  diversifyWeeklyPushCandidates,
  selectPersonalizedWeeklyPushPool,
  selectTopicFallbackWeeklyPushPool,
  sortWeeklyPushCandidates,
} from "@/lib/weekly-push-selection";
import {
  buildWeeklyPushDigestHtml,
  getWeeklyPushEmailSubject,
  type WeeklyPushDigestPaper,
} from "@/lib/weekly-push-email";
import {
  hasWeeklyPushDeliveryForIssue,
  insertWeeklyPushDeliveries,
  listActiveWeeklyPushProfiles,
  listDeliveredWeeklyPushPaperIds,
  listWeeklyPushCandidatePapers,
  markWeeklyPushIssueSent,
  replaceWeeklyPushIssueItems,
  upsertWeeklyPushIssueDraft,
} from "@/server/repositories/weekly-push";

const DEFAULT_WEEKLY_PUSH_TARGET_COUNT = 7;
const STRICT_WEEKLY_PUSH_REASON =
  "\u4e0e\u60a8\u7684\u671f\u520a\u8ba2\u9605\u548c\u5173\u952e\u8bcd\u504f\u597d\u540c\u65f6\u5339\u914d";
const TOPIC_FALLBACK_WEEKLY_PUSH_REASON =
  "\u672c\u5468\u6682\u65e0\u66f4\u591a\u540c\u65f6\u5339\u914d\u671f\u520a\u548c\u5173\u952e\u8bcd\u7684\u6587\u732e\uff0c\u8fd9\u7bc7\u4e0e\u60a8\u7684\u7814\u7a76\u4e3b\u9898\u5f3a\u76f8\u5173";

function getWeeklyPushTargetCount() {
  const configured = Number(process.env.WEEKLY_PUSH_TARGET_COUNT ?? DEFAULT_WEEKLY_PUSH_TARGET_COUNT);
  if (!Number.isFinite(configured)) return DEFAULT_WEEKLY_PUSH_TARGET_COUNT;
  return Math.max(1, Math.min(20, Math.floor(configured)));
}

export async function runWeeklyPushJob() {
  const supabase = createServiceSupabaseClient();
  const targetCount = getWeeklyPushTargetCount();
  const now = new Date();
  const currentWeekStart = startOfIsoWeek(now);
  const summaryStart = new Date(currentWeekStart);
  summaryStart.setUTCDate(summaryStart.getUTCDate() - 7);
  const summaryEnd = new Date(currentWeekStart);
  summaryEnd.setUTCDate(summaryEnd.getUTCDate() - 1);
  const summaryStartStr = toDateString(summaryStart);
  const summaryEndStr = toDateString(summaryEnd);

  const candidatesAll = await listWeeklyPushCandidatePapers(supabase, {
    summaryStart: summaryStartStr,
    summaryEnd: summaryEndStr,
    limit: 200,
  });
  const candidatePool = sortWeeklyPushCandidates(
    candidatesAll.filter(
      (paper) =>
        (paper.quality_tier ?? "").toLowerCase() === "top" ||
        (paper.quality_score ?? 0) >= 0.72,
    ),
  );
  const selected = diversifyWeeklyPushCandidates(candidatePool, targetCount);

  const issueMeta = {
    fromDate: summaryStartStr,
    toDate: summaryEndStr,
    targetCount,
    candidateCount: candidatePool.length,
    selectedCount: selected.length,
  };

  const issueId = await upsertWeeklyPushIssueDraft(supabase, {
    issueWeekStart: summaryStartStr,
    meta: issueMeta,
  });
  await replaceWeeklyPushIssueItems(supabase, {
    issueId,
    papers: selected,
  });

  const profiles = await listActiveWeeklyPushProfiles(supabase);

  const sendEmail = createResendEmailSender();

  let sentCount = 0;
  let skippedRepeatedUsers = 0;
  let skippedNoMatchUsers = 0;
  let skippedNoFreshPapersUsers = 0;
  let failedEmailUsers = 0;
  let fallbackPaperCount = 0;
  for (const profile of profiles) {
    const to = String(profile.contact_email || "").trim();
    if (!to) continue;
    const alreadySentInIssue = await hasWeeklyPushDeliveryForIssue(supabase, {
      issueId,
      userId: profile.id,
    });
    if (alreadySentInIssue) {
      skippedRepeatedUsers += 1;
      continue;
    }

    const exactCandidatesRaw = selectPersonalizedWeeklyPushPool(candidatePool, profile);
    const topicFallbackCandidatesRaw = selectTopicFallbackWeeklyPushPool(candidatePool, profile);
    if (!exactCandidatesRaw.length && !topicFallbackCandidatesRaw.length) {
      skippedNoMatchUsers += 1;
      continue;
    }

    const personalizedCandidateIds = Array.from(
      new Set([
        ...exactCandidatesRaw.map((paper) => paper.id),
        ...topicFallbackCandidatesRaw.map((paper) => paper.id),
      ]),
    );
    const deliveredSet = await listDeliveredWeeklyPushPaperIds(supabase, {
      userId: profile.id,
      paperIds: personalizedCandidateIds,
    });
    const exactCandidates = exactCandidatesRaw.filter(
      (paper) => !deliveredSet.has(paper.id),
    );
    const exactSelected = diversifyWeeklyPushCandidates(exactCandidates, targetCount);
    const selectedExactIds = new Set(exactSelected.map((paper) => paper.id));

    const topicFallbackCandidates = topicFallbackCandidatesRaw.filter(
      (paper) => !deliveredSet.has(paper.id) && !selectedExactIds.has(paper.id),
    );
    const topicFallbackSelected =
      exactSelected.length < targetCount
        ? diversifyWeeklyPushCandidates(topicFallbackCandidates, targetCount - exactSelected.length)
        : [];
    const personalized: WeeklyPushDigestPaper[] = [
      ...exactSelected.map((paper) => ({
        ...paper,
        source_type: "precision" as const,
        recommendation_reason: STRICT_WEEKLY_PUSH_REASON,
      })),
      ...topicFallbackSelected.map((paper) => ({
        ...paper,
        source_type: "serendipity" as const,
        recommendation_reason: TOPIC_FALLBACK_WEEKLY_PUSH_REASON,
      })),
    ];
    if (!personalized.length) {
      skippedNoFreshPapersUsers += 1;
      continue;
    }
    fallbackPaperCount += topicFallbackSelected.length;
    const html = buildWeeklyPushDigestHtml(personalized);
    try {
      await sendEmail({
        to,
        subject: getWeeklyPushEmailSubject(summaryStartStr, summaryEndStr),
        html,
      });
    } catch {
      failedEmailUsers += 1;
      continue;
    }

    const deliveryRows = personalized.map((paper) => ({
      issue_id: issueId,
      user_id: profile.id,
      paper_id: paper.id,
      issue_week_start: summaryStartStr,
      delivered_at: new Date().toISOString(),
    }));
    await insertWeeklyPushDeliveries(supabase, deliveryRows);
    sentCount += 1;
  }

  await markWeeklyPushIssueSent(supabase, {
    issueId,
    meta: {
      ...issueMeta,
      sentCount,
      skippedRepeatedUsers,
      skippedNoMatchUsers,
      skippedNoFreshPapersUsers,
      failedEmailUsers,
      fallbackPaperCount,
    },
  });

  return {
    issueId,
    weekStart: summaryStartStr,
    weekEnd: summaryEndStr,
    selectedCount: selected.length,
    sentCount,
    skippedRepeatedUsers,
    skippedNoMatchUsers,
    skippedNoFreshPapersUsers,
    failedEmailUsers,
    fallbackPaperCount,
  };
}
