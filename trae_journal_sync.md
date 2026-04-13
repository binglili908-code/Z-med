# Z-Lab 期刊级同步方案：白名单期刊论文零遗漏

## 一、问题诊断

当前的 PubMed 同步只有一条线路：用通用 AI 关键词搜索 → 入库 → 评分。
结果是 29 本白名单期刊中 **14 本一篇论文都没抓到**：

| 期刊 | IF | 论文数 |
|------|-----|--------|
| JAMA Network Open | 9.7 | **0** |
| Radiology | 10.2 | **0** |
| Medical Image Analysis | 11.8 | **0** |
| Science | 45.8 | **0** |
| Nature Reviews Clinical Oncology | 82.2 | **0** |
| IEEE Transactions on Medical Imaging | 10.0 | **0** |
| ... 等 14 本 | | **0** |

原因：这些期刊的论文标题不一定包含 "deep learning"、"machine learning" 等通用 AI 关键词，导致关键词搜索漏掉了它们。

## 二、解决方案：双线同步

```
线路 A（现有）：关键词同步
  查询：(AI关键词) AND (医学关键词) AND 最近7天
  特点：覆盖面广，能发现非白名单期刊的好论文
  频率：每天 1 次

线路 B（新增）：期刊同步  ← 本次新增
  查询："{期刊名}"[Journal] AND 最近7天
  特点：白名单期刊的论文一篇不漏
  频率：每天 1 次（与线路 A 交替，错开时间）
```

两条线路抓回来的论文都经过同一个评分函数 `calculate_ai_med_score()` 打分，只有通过的才展示给用户。

## 三、PubMed API 按期刊搜索的方法

PubMed E-Utilities API 天然支持按期刊名搜索，不需要爬虫：

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?
  db=pubmed
  &term="npj digital medicine"[Journal]+AND+2026/04/01:2026/04/13[dp]
  &retmax=100
  &retmode=json
```

这条查询会返回 npj Digital Medicine 在 2026-04-01 到 2026-04-13 之间发表的所有论文的 PMID 列表。然后用 efetch 获取详情，跟现有流程一样。

## 四、Trae 需要实现的代码

### 4.1 新建 Cron 端点：`/api/cron/journal-sync`

```typescript
// src/app/api/cron/journal-sync/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  // 验证 Cron Secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. 读取所有活跃的白名单期刊
    const { data: journals } = await supabase
      .from('journal_quality')
      .select('id, journal_name, aliases')
      .eq('is_active', true);

    if (!journals) return NextResponse.json({ error: 'No journals' }, { status: 500 });

    // 2. 计算同步窗口：最近 7 天
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const syncFrom = formatPubMedDate(weekAgo);  // "2026/04/06"
    const syncTo = formatPubMedDate(today);       // "2026/04/13"

    let totalFound = 0;
    let totalNew = 0;

    // 3. 逐期刊查询 PubMed
    for (const journal of journals) {
      try {
        const result = await syncJournal(journal, syncFrom, syncTo);
        totalFound += result.found;
        totalNew += result.newPapers;
        
        // 记录同步日志
        await supabase.from('journal_sync_log').insert({
          journal_quality_id: journal.id,
          journal_name: journal.journal_name,
          sync_from: weekAgo.toISOString().split('T')[0],
          sync_to: today.toISOString().split('T')[0],
          papers_found: result.found,
          papers_passed: result.passed,
          papers_new: result.newPapers,
          status: 'success',
          finished_at: new Date().toISOString()
        });

        // PubMed API 限流：每秒最多 3 次请求
        await sleep(400);
      } catch (err) {
        console.error(`Failed to sync ${journal.journal_name}:`, err);
        await supabase.from('journal_sync_log').insert({
          journal_quality_id: journal.id,
          journal_name: journal.journal_name,
          sync_from: weekAgo.toISOString().split('T')[0],
          sync_to: today.toISOString().split('T')[0],
          status: 'failed',
          error_message: String(err),
          finished_at: new Date().toISOString()
        });
      }
    }

    // 4. 更新全局游标
    await supabase
      .from('sync_state')
      .update({ value: today.toISOString().split('T')[0], updated_at: new Date().toISOString() })
      .eq('key', 'journal_sync_last_run');

    return NextResponse.json({
      success: true,
      journals_synced: journals.length,
      total_found: totalFound,
      total_new: totalNew
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function syncJournal(
  journal: { id: string; journal_name: string; aliases: string[] },
  dateFrom: string,
  dateTo: string
) {
  // 构建 PubMed 查询
  const journalQuery = `"${journal.journal_name}"[Journal]`;
  const dateQuery = `${dateFrom}:${dateTo}[dp]`;
  const query = `${journalQuery} AND ${dateQuery}`;

  // 搜索 PMID 列表
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=100&retmode=json`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();
  
  const pmids: string[] = searchData?.esearchresult?.idlist || [];
  
  if (pmids.length === 0) {
    return { found: 0, passed: 0, newPapers: 0 };
  }

  // 过滤掉已存在的 PMID
  const { data: existing } = await supabase
    .from('papers')
    .select('pmid')
    .in('pmid', pmids);
  
  const existingPmids = new Set((existing || []).map(p => p.pmid));
  const newPmids = pmids.filter(id => !existingPmids.has(id));

  if (newPmids.length === 0) {
    return { found: pmids.length, passed: 0, newPapers: 0 };
  }

  // 获取论文详情
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${newPmids.join(',')}&retmode=xml`;
  const fetchRes = await fetch(fetchUrl);
  const xmlText = await fetchRes.text();
  
  // 解析 XML 提取论文数据（复用现有的 parsePubMedXml 函数）
  const papers = parsePubMedXml(xmlText);

  let passed = 0;
  let inserted = 0;

  for (const paper of papers) {
    // 调用数据库评分函数
    const { data: scoreResult } = await supabase.rpc('calculate_ai_med_score', {
      p_title: paper.title,
      p_abstract: paper.abstract || ''
    });

    const score = parseFloat(scoreResult.score);
    const isAiMed = scoreResult.is_ai_med;

    if (isAiMed) passed++;

    // 匹配 journal_quality 计算 quality_score
    const matchedJournal = journal; // 已知期刊
    const weight = await getJournalWeight(journal.journal_name);
    const qualityScore = Math.round(score * weight * 10000) / 10000;

    // 插入数据库
    const { error } = await supabase.from('papers').insert({
      pmid: paper.pmid,
      title: paper.title,
      abstract: paper.abstract,
      journal: paper.journal || journal.journal_name,
      publication_date: paper.publicationDate,
      pubmed_url: `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`,
      keywords: paper.keywords || [],
      mesh_terms: paper.meshTerms || [],
      is_open_access: paper.isOpenAccess || false,
      oa_pdf_url: paper.oaPdfUrl,
      ai_med_score: score,
      is_ai_med: isAiMed,
      quality_tier: isAiMed ? (weight >= 0.9 ? 'top' : 'core') : 'emerging',
      quality_score: qualityScore
    });

    if (!error) inserted++;
  }

  return { found: pmids.length, passed, newPapers: inserted };
}

function formatPubMedDate(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// parsePubMedXml 和 getJournalWeight 请复用现有的 pubmed-sync.ts 中的函数
```

### 4.2 配置 Vercel Cron

在 `vercel.json` 中添加（如果尚未配置）：

```json
{
  "crons": [
    {
      "path": "/api/cron/pubmed-sync",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/cron/journal-sync",
      "schedule": "0 12 * * *"
    },
    {
      "path": "/api/cron/ai-analysis",
      "schedule": "0 18 * * *"
    }
  ]
}
```

时间安排：
- 06:00 UTC：关键词同步（线路 A）
- 12:00 UTC：期刊同步（线路 B）← 新增
- 18:00 UTC：AI 翻译

### 4.3 注意事项

1. **PubMed API 限流**：未注册用户每秒最多 3 次请求。29 本期刊每个查 1 次 = 29 次请求，加上 400ms 间隔，总耗时约 12 秒。如果你有 NCBI API Key，可以提高到每秒 10 次。

2. **去重**：插入前先检查 PMID 是否已存在，避免重复入库。

3. **emerging 过滤**：期刊同步抓回来的论文如果评分函数判定 `is_ai_med = false`，也不会进入推送池——它们会被存入数据库但不展示。这确保了只有真正的 AI+医学论文才会被推送。

4. **复用现有代码**：`parsePubMedXml` 函数（解析 PubMed 返回的 XML）已经在 `pubmed-sync.ts` 里实现了，直接复用即可，不需要重写。

## 五、完成后确认

- [ ] `/api/cron/journal-sync` 端点创建
- [ ] 逐期刊查询 PubMed API 并入库
- [ ] 入库前调用 `calculate_ai_med_score` 评分
- [ ] 去重检查（PMID 不重复插入）
- [ ] `journal_sync_log` 有同步记录
- [ ] `vercel.json` 配置了 Cron 时间表
- [ ] npm run build 通过
