import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  Code2,
  Database,
  GitFork,
  Github,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getModelHubPageData } from "@/lib/github-model-hub";
import type { ModelHubItem, ModelHubResponse } from "@/shared/contracts/model-hub";

export const dynamic = "force-dynamic";

type ModelHubPageProps = {
  searchParams?: Promise<{
    category?: string | string[];
  }>;
};

const CATEGORY_LABELS: Record<string, string> = {
  "medical-ai": "医学 AI",
  "medical-imaging": "医学影像",
  radiology: "放射影像",
  pathology: "数字病理",
  bioinformatics: "生信组学",
  "drug-discovery": "AI 药物发现",
  "clinical-ai": "临床 AI",
  "clinical-llm": "医学大模型",
  "resource-list": "资源合集",
};

const TASK_LABELS: Record<string, string> = {
  benchmark: "评测",
  classification: "分类",
  detection: "检测",
  framework: "框架",
  generation: "生成",
  "medical-nlp": "医学 NLP",
  project: "项目",
  reconstruction: "重建",
  "resource-list": "资源集",
  segmentation: "分割",
};

const SIGNAL_LABELS: Record<string, string> = {
  "demo-or-inference": "Demo/推理",
  "foundation-model": "基础模型",
  "paper-backed": "论文支撑",
  "pretrained-weights": "预训练权重",
  "trainable-code": "可训练代码",
};

const FLAG_LABELS: Record<string, string> = {
  "broad-description": "描述过宽",
  "early-stage": "早期项目",
  "missing-license": "许可证待核验",
  "needs-review": "需人工复核",
  "resource-list": "资源集",
  stale: "更新较旧",
};

const CURATION_STATUS_LABELS: Record<string, string> = {
  archived: "Archived",
  featured: "Featured",
  hold: "Hold",
  recommended: "Recommended",
  watchlist: "Watchlist",
};

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

function formatDate(value: string | null) {
  if (!value) return "未知";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function labelFor(map: Record<string, string>, value: string) {
  return map[value] ?? value;
}

async function loadModelHubData(category: string | null): Promise<ModelHubResponse> {
  try {
    return await getModelHubPageData({
      category,
      limit: 48,
    });
  } catch (error) {
    console.error("[model-hub-page-load-failed]", error);
    return {
      items: [],
      total: 0,
      category,
      lastSyncedAt: null,
      configured: false,
    };
  }
}

function getCategoryFromParams(
  searchParams: Awaited<NonNullable<ModelHubPageProps["searchParams"]>> | undefined,
) {
  const raw = searchParams?.category;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || null;
}

function CategoryLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
      }
    >
      {label}
    </Link>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Star;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
      <Icon className="h-4 w-4 text-slate-500" />
      <span>{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function ModelCard({ item }: { item: ModelHubItem }) {
  const tags = [...item.domain_tags, ...item.task_types].slice(0, 5);
  const signals = item.model_signals.slice(0, 3);
  const flags = item.quality_flags.slice(0, 3);
  const targetUsers = item.target_users.slice(0, 4);
  const curationTags = item.curation_tags.slice(0, 4);
  const displayScore = item.curated_score ?? item.recommendation_score;
  const recommendation =
    item.curated_recommendation_reason ?? item.recommendation_reason;

  return (
    <Card className="overflow-hidden rounded-lg">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {item.curation_status ? (
                <Badge tone="brand">
                  {labelFor(CURATION_STATUS_LABELS, item.curation_status)}
                </Badge>
              ) : null}
              <Badge tone="teal">{labelFor(CATEGORY_LABELS, item.category)}</Badge>
              {item.language ? <Badge>{item.language}</Badge> : null}
              {item.license_spdx ? <Badge>{item.license_spdx}</Badge> : null}
            </div>
            <h2 className="mt-3 break-words text-lg font-semibold tracking-tight text-slate-950">
              {item.full_name}
            </h2>
          </div>
          <div className="rounded-lg bg-slate-900 px-3 py-2 text-right text-white">
            <div className="text-xs text-slate-300">
              {item.curated_score == null ? "Score" : "Curated"}
            </div>
            <div className="text-lg font-semibold">{Math.round(displayScore)}</div>
          </div>
        </div>

        <p className="mt-3 line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-slate-600">
          {item.description?.trim() || "暂无项目描述。"}
        </p>

        {item.curator_summary ? (
          <div className="mt-3 flex gap-2 rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-sm leading-6 text-teal-900">
            <Sparkles className="mt-1 h-4 w-4 shrink-0" />
            <p>{item.curator_summary}</p>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric icon={Star} label="Stars" value={formatCount(item.stargazers_count)} />
          <Metric icon={GitFork} label="Forks" value={formatCount(item.forks_count)} />
          <Metric icon={Activity} label="Issues" value={formatCount(item.open_issues_count)} />
          <Metric icon={CalendarClock} label="更新" value={formatDate(item.pushed_at)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag}>{labelFor(TASK_LABELS, labelFor(CATEGORY_LABELS, tag))}</Badge>
          ))}
        </div>

        {signals.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {signals.map((signal) => (
              <Badge key={signal} tone="brand">
                {labelFor(SIGNAL_LABELS, signal)}
              </Badge>
            ))}
          </div>
        ) : null}

        {targetUsers.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-slate-500" />
            {targetUsers.map((targetUser) => (
              <Badge key={targetUser}>{targetUser}</Badge>
            ))}
          </div>
        ) : null}

        {curationTags.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {curationTags.map((tag) => (
              <Badge key={tag} tone="brand">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        {flags.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {flags.map((flag) => (
              <span
                key={flag}
                className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
              >
                {labelFor(FLAG_LABELS, flag)}
              </span>
            ))}
          </div>
        ) : null}

        {recommendation ? (
          <p className="mt-4 text-sm leading-6 text-slate-700">{recommendation}</p>
        ) : null}

        {item.project_understanding ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
            {item.project_understanding}
          </p>
        ) : null}

        {item.risk_notes ? (
          <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
            <ShieldAlert className="mt-1 h-4 w-4 shrink-0" />
            <p>{item.risk_notes}</p>
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
            <Code2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.default_branch ?? "main"}</span>
          </div>
          <Link
            href={item.html_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            GitHub
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ configured }: { configured: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        {configured ? (
          <Search className="h-5 w-5 text-slate-600" />
        ) : (
          <Database className="h-5 w-5 text-slate-600" />
        )}
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-950">
        {configured ? "暂无匹配项目" : "模型 Hub 数据表待上线"}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        {configured
          ? "当前筛选下没有可展示项目。"
          : "应用代码已经准备好，待 DB owner 应用 model_hub_items 与 model_hub_sync_runs SQL 后即可开始同步。"}
      </p>
    </div>
  );
}

export default async function ModelHubPage({ searchParams }: ModelHubPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const category = getCategoryFromParams(resolvedSearchParams);
  const data = await loadModelHubData(category);
  const activeCategories = Array.from(
    new Set(data.items.map((item) => item.category).filter(Boolean)),
  ).sort();

  return (
    <main className="mx-auto max-w-7xl px-6 pb-20 pt-10">
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Github className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">
              Model Hub
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
              医学 AI 开源模型与工具
            </h1>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
          聚合 GitHub 上与医学影像、临床大模型、生信组学、AI 药物发现相关的开源项目，按相关性、活跃度和可复用信号排序。
        </p>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">收录项目</div>
          <div className="mt-1 text-2xl font-bold text-slate-950">{data.total}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">最新同步</div>
          <div className="mt-1 text-2xl font-bold text-slate-950">
            {formatDate(data.lastSyncedAt)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">当前视图</div>
          <div className="mt-1 text-2xl font-bold text-slate-950">
            {category ? labelFor(CATEGORY_LABELS, category) : "全部"}
          </div>
        </div>
      </section>

      <nav className="mb-6 flex flex-wrap gap-2">
        <CategoryLink href="/model-hub" label="全部" active={!category} />
        {activeCategories.map((itemCategory) => (
          <CategoryLink
            key={itemCategory}
            href={`/model-hub?category=${encodeURIComponent(itemCategory)}`}
            label={labelFor(CATEGORY_LABELS, itemCategory)}
            active={category === itemCategory}
          />
        ))}
      </nav>

      {data.items.length ? (
        <section className="grid gap-5 lg:grid-cols-2">
          {data.items.map((item) => (
            <ModelCard key={item.id} item={item} />
          ))}
        </section>
      ) : (
        <EmptyState configured={data.configured} />
      )}
    </main>
  );
}
