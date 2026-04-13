# Z-Lab 推送算法优化方案 — 已执行 + 待执行

---

## 一、已完成的数据库优化（架构师已执行）

### 评分函数 `calculate_ai_med_score(title, abstract)`

**创建了一个 PostgreSQL 数据库函数**，替代了之前硬编码在代码里的简单打分逻辑。

核心设计：
- **AI 关键词分两级**：强关键词（deep learning, neural network, LLM 等 30+ 个）和弱关键词（prediction model, algorithm 等 15 个）
- **标题权重 > 摘要权重**：标题里出现 AI 关键词 = 这篇论文的核心主题是 AI
- **交叉加分**：标题同时出现 AI + 医学关键词额外 +0.10
- **通过标准**：分数 ≥ 0.45 **且** 标题必须包含至少 1 个强 AI 关键词

### 优化效果对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 通过率 | 86.5% (386/446) | **44.8% (200/446)** |
| 分数区间 | 0.20-0.50（78% 挤在 0.20-0.29） | **0.45-0.86（分散均匀）** |
| 平均分 | 0.2782 | **0.5904** |
| Top Tier 论文 | 90 | **53**（更精准） |
| 被淘汰的 | 编辑评论、观点文章、只提到 AI 但不是 AI 研究的论文 |

### 全量重算已执行
- 446 篇论文的 ai_med_score 已全部用新函数重算
- is_ai_med 已按新阈值重新标记
- quality_score 已基于新的 ai_med_score 重算

---

## 二、Trae 需要执行的代码改动

### 改动 1：设置页简化（P0）

**去掉**所有学科标签、期刊勾选列表、AI 推荐按钮。
**只保留**两个输入区域：

```
关键词（tags 输入）→ profiles.subscription_keywords
期刊名（tags 输入）→ profiles.custom_journals
```

用户直接打字输入关键词和期刊名，按回车确认，显示为可删除的标签。

### 改动 2：Feed API 重构（P0）

```typescript
async function getFeed(userId, page, pageSize) {
  const { keywords, custom_journals } = await getUserPreferences(userId);
  
  let query = supabase
    .from('papers')
    .select('*', { count: 'exact' })
    .eq('is_ai_med', true)
    .order('quality_score', { ascending: false });

  // 期刊过滤（ILIKE 模糊匹配，OR 关系）
  if (custom_journals && custom_journals.length > 0) {
    const journalFilters = custom_journals
      .map(j => `journal.ilike.%${j}%`)
      .join(',');
    query = query.or(journalFilters);
  }

  // 关键词过滤（搜中英文标题+摘要，OR 关系）
  if (keywords && keywords.length > 0) {
    const kwFilters = keywords.flatMap(kw => [
      `title.ilike.%${kw}%`,
      `abstract.ilike.%${kw}%`,
      `title_zh.ilike.%${kw}%`,
      `abstract_zh.ilike.%${kw}%`,
    ]).join(',');
    query = query.or(kwFilters);
  }

  // 如果期刊和关键词都设了 → AND 关系
  // 实现方式：先按期刊筛出候选集，再在候选集里按关键词过滤
  // Supabase 的 .or() 是同一层级的 OR，需要嵌套处理：
  // 建议用 RPC 调用数据库函数来实现复杂的 AND/OR 组合

  return await query.range((page-1)*pageSize, page*pageSize-1);
}
```

**注意**：如果期刊和关键词都设了，需要是 AND 关系（在这些期刊里搜这些关键词）。Supabase 的 `.or()` 只能做 OR，AND 需要嵌套。建议的实现方式：

```typescript
// 方案 A：两步查询
// 1. 先按期刊筛
// 2. 在结果里按关键词筛

// 方案 B：用 Supabase RPC 调数据库函数（推荐）
const { data } = await supabase.rpc('get_personalized_feed', {
  p_user_id: userId,
  p_page: page,
  p_page_size: pageSize
});
```

### 改动 3：pubmed-sync.ts 改用数据库函数评分（P1）

```typescript
// 替代现有的硬编码评分
const { data } = await supabase.rpc('calculate_ai_med_score', {
  p_title: paper.title,
  p_abstract: paper.abstract
});

const score = parseFloat(data.score);
const isAiMed = data.is_ai_med;

// 写入 papers 表
await supabase.from('papers').upsert({
  pmid: paper.pmid,
  title: paper.title,
  abstract: paper.abstract,
  journal: paper.journal,
  ai_med_score: score,
  is_ai_med: isAiMed,
  // ... 其他字段
});
```

这样评分逻辑集中在数据库函数里，架构师可以随时调整权重和关键词，不需要改代码重新部署。

### 改动 4：不再读写的表（注释掉）

- `user_journal_subscriptions` → 不再读写
- `subject_categories` → 不再读写
- `research_topics` / `paper_research_topics` / `user_topic_subscriptions` → 不再读写

---

## 三、架构师后续可在数据库层做的事（不需要 Trae 参与）

### 3.1 创建个性化 Feed 数据库函数

```sql
-- 架构师随时可以创建/修改这个函数
CREATE OR REPLACE FUNCTION get_personalized_feed(
  p_user_id uuid,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 20
) RETURNS TABLE (...) AS $$
-- 读取用户偏好
-- 按期刊 + 关键词过滤
-- 按 quality_score 排序
-- 返回分页结果
$$;
```

### 3.2 调整评分权重

架构师可以直接修改 `calculate_ai_med_score` 函数中的关键词列表和权重值，修改后立即对新入库的论文生效，也可以全量重算历史论文。

### 3.3 扩充关键词词典

根据用户反馈，添加更多 AI/医学关键词到评分函数中。

### 3.4 白名单期刊维护

根据需要添加/删除 journal_quality 中的期刊，调整 weight 值。

---

## 四、整体数据流

```
PubMed API ─→ pubmed-sync.ts 抓取 ─→ 调用 calculate_ai_med_score() ─→ papers 表
                                              ↓
                                      is_ai_med = true/false
                                      ai_med_score = 0.00-1.00
                                              ↓
                                      匹配 journal_quality 白名单
                                              ↓
                                      quality_score = ai_med_score × weight
                                      quality_tier = top/core/emerging
                                              ↓
                              用户访问首页 → Feed API 读取
                                              ↓
                                      按 custom_journals 过滤期刊
                                      按 keywords 过滤关键词
                                      按 quality_score DESC 排序
                                              ↓
                                      展示给用户
```

---

## 五、验收标准

- [ ] 设置页只有关键词和期刊名两个输入框
- [ ] Feed 能按用户输入的期刊名过滤（ILIKE 模糊匹配）
- [ ] Feed 能按用户输入的关键词搜索中英文标题和摘要
- [ ] 新论文入库时调用数据库函数评分
- [ ] 通过率维持在 40-50%
- [ ] npm run build 通过
