# 紧急修复：Feed API 必须调用 get_personalized_feed 数据库函数

## 当前问题

`/api/papers/feed` 端点直接查询 papers 表，没有时间截止和时效排序，导致：
- 用户看到 2025-11 和 2026-02 的旧论文
- 用户设置的关键词（"心血管"）没有生效
- 高分专科期刊论文（JACC, Stroke, European Heart Journal）不显示

## 必须做的修改

### 文件：`src/app/api/papers/feed/route.ts`

找到查询论文的代码（大概长这样）：

```typescript
// ❌ 当前的写法（不要用）
const { data } = await supabase
  .from('papers')
  .select('*')
  .eq('is_ai_med', true)
  .order('quality_score', { ascending: false })
  .range(...)
```

**替换为：**

```typescript
// ✅ 调用数据库函数（时间截止 + 时效衰减 + 关键词匹配 全在里面）
const { data: feedData, error } = await supabase.rpc('get_personalized_feed', {
  p_user_id: userId,    // 当前登录用户的 UUID
  p_page: page,         // 页码，默认 1
  p_page_size: pageSize // 每页条数，默认 20
});

if (error) {
  console.error('Feed RPC error:', error);
  return NextResponse.json({ error: 'Failed to fetch feed' }, { status: 500 });
}

// feedData 的格式：
// {
//   total: 150,
//   page: 1,
//   page_size: 20,
//   papers: [{ id, title, title_zh, journal, journal_if, publication_date, quality_score, final_score, ... }]
// }

return NextResponse.json({
  papers: feedData.papers,
  total: feedData.total,
  page: feedData.page,
  pageSize: feedData.page_size,
  personalized: true
});
```

### 关键点

1. **必须传 `p_user_id`**：这是当前登录用户的 UUID，从 session 获取
2. **如果用户未登录**：可以传一个默认的 UUID 或者不传关键词相关参数，函数会返回全局推荐（无关键词过滤，但仍有 30 天时间截止）
3. **不需要自己做排序**：数据库函数已经按 `final_score DESC`（质量分 × 时效衰减）排好了
4. **不需要自己做分页**：数据库函数已经用 LIMIT/OFFSET 分好了

### 数据库函数返回的字段

```typescript
{
  id: string,
  title: string,
  title_zh: string | null,
  abstract: string,
  abstract_zh: string | null,
  journal: string,
  publication_date: string,     // 如 "2026-04-15"
  ai_med_score: number,
  quality_score: number,
  quality_tier: "top" | "core",
  pubmed_url: string,
  is_open_access: boolean,
  journal_if: number,           // 如 21.7
  journal_jcr: string,          // 如 "Q1"
  journal_cas_zone: string,     // 如 "1区"
  recommendation_reason: string | null,
  final_score: number           // 质量分 × 时效衰减
}
```

### 验证方法

部署后访问首页，设关键词"心血管"，应该：
- ✅ 看到 JACC (IF 21.7)、Stroke (IF 8.9)、European Heart Journal Digital Health 等论文
- ✅ 所有论文都在最近 30 天内
- ✅ 不会出现 2025-11 或 2026-02 的旧论文
- ✅ 排序：最近 7 天的高分论文排最前面

### 如果用户未登录怎么办

可以降级为无个性化的全局推荐：

```typescript
if (!userId) {
  // 未登录：直接查最近30天的高分论文（无关键词过滤）
  const { data } = await supabase
    .from('papers')
    .select('id, title, title_zh, journal, journal_if, journal_jcr, journal_cas_zone, publication_date, quality_score, quality_tier, pubmed_url, is_open_access')
    .eq('is_ai_med', true)
    .in('quality_tier', ['top', 'core'])
    .gte('publication_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    .order('quality_score', { ascending: false })
    .range(0, pageSize - 1);

  return NextResponse.json({ papers: data, personalized: false });
}
```
