# Z-Lab 架构重构：精准订阅 + 智能混排

## 一、架构评估总结

### 当前数据库最终状态（13 张表）

| 表名 | 职责 | 数据量 | 本轮动作 |
|------|------|--------|----------|
| `papers` | 文献主表（含质量分数体系） | 102 篇 | 不动 |
| `journal_quality` | 期刊白名单 | 32 本 | 不动 |
| `research_topics` | 研究方向字典（5 大方向） | 5 条 | 不动 |
| `paper_research_topics` | 论文-方向多标签关联 | 有数据 | 不动 |
| `user_topic_subscriptions` | 用户订阅方向 | 0 条 | 需要前端激活 |
| `profiles` | 用户画像 + **新增** top_journals_only, subscription_min_score | 2 条 | ✅ 已增强 |
| `feed_recommendations` | **新增** 推荐结果统一出口 | 0 条 | ✅ 已建 |
| `user_paper_interactions` | 已读/收藏 | — | 不动 |
| `ai_analysis_queue` | AI 解读任务队列 | — | 不动 |
| `ai_digest_log` | 邮件发送日志 | — | 不动 |
| `push_issues` + `push_issue_items` | 周报系统 | — | 暂保留 |
| `sync_state` | 同步游标 | — | 不动 |
| ~~`paper_topics`~~ | 旧表 | — | ✅ 已删除 |

### 核心设计理念

整个系统分三层，Trae 只做前两层，第三层留接口给算法工程师：

```
┌─────────────────────────────────────────────────┐
│ 第一层：订阅配置层（Trae 做）                      │
│  用户在设置页选择：                                │
│  · 目标领域（user_topic_subscriptions）            │
│  · 自定义关键词（profiles.subscription_keywords）  │
│  · 仅看顶刊开关（profiles.top_journals_only）      │
│  · 最低分数阈值（profiles.subscription_min_score） │
├─────────────────────────────────────────────────┤
│ 第二层：内容获取层（Trae 做，极简实现）             │
│  · Feed API：读取用户偏好 → 查 papers 表 → 返回    │
│  · 当前占位逻辑：按 quality_score DESC + 领域过滤   │
│  · 写入 feed_recommendations 表                    │
├─────────────────────────────────────────────────┤
│ 第三层：推荐算法层（算法工程师做，Trae 预留接口）    │
│  · 读取用户偏好 + 论文池 → 产出 feed_recommendations│
│  · 黄金配比：精准命中 / 全局热点 / 跨界启发          │
│  · source_type 字段区分三种来源                     │
│  · recommendation_score 替代简单的 quality_score    │
└─────────────────────────────────────────────────┘
```

---

## 二、给 Trae 的执行指令

### 已完成的数据库变更（我已在 Supabase 执行）

1. `profiles` 表新增 2 个字段：
   - `top_journals_only` (boolean, 默认 false) — 仅看顶刊开关
   - `subscription_min_score` (numeric, 默认 0) — 最低质量分数阈值

2. 新增 `feed_recommendations` 表 — 推荐结果统一出口，包含：
   - `user_id`, `paper_id` — 谁被推荐了什么
   - `source_type` — 'precision' / 'trending' / 'serendipity'（三种推荐来源）
   - `recommendation_score` — 推荐分数
   - `reason` — 推荐理由（展示给用户的文字）
   - `is_consumed` — 用户是否已消费
   - `batch_date` — 按日期分组
   - 唯一约束：(user_id, paper_id, batch_date)

3. 已删除废弃表 `paper_topics`

### 你需要实现的模块（按优先级）

#### P0：用户订阅设置页面（/settings）

在已有的 /settings 页面中增加"订阅偏好"区域：

**UI 组件：**
- 研究方向多选（从 research_topics 表读取 5 大方向，checkbox 多选）
  - 写入/更新 `user_topic_subscriptions` 表
- 自定义关键词输入（tags 输入模式，支持添加/删除）
  - 写入 `profiles.subscription_keywords`
- "仅看顶刊" 开关（toggle switch）
  - 写入 `profiles.top_journals_only`

**API 端点：**
- `GET /api/user/subscription` — 获取当前用户订阅配置
- `PUT /api/user/subscription` — 保存订阅配置

```typescript
// 请求体类型定义（接口要稳固）
interface UserSubscription {
  topic_slugs: string[];           // 选中的研究方向 slug 数组
  keywords: string[];              // 自定义关键词数组
  top_journals_only: boolean;      // 仅看顶刊
  min_score?: number;              // 最低分数阈值（可选，默认不展示给用户）
}
```

#### P1：重构 Feed API（精准订阅过滤）

重构 `/api/papers/feed`，读取用户订阅偏好后过滤：

```typescript
// Feed API 的输入输出接口定义（稳固，算法工程师未来不改接口只改内部逻辑）

interface FeedRequest {
  page: number;
  pageSize: number;
  topic?: string;       // 可选的方向过滤
}

interface FeedResponse {
  papers: FeedItem[];
  total: number;
  page: number;
}

interface FeedItem {
  // 论文基础信息
  id: string;
  title: string;
  journal: string;
  publication_date: string;
  quality_score: number;
  quality_tier: 'top' | 'core' | 'emerging';
  is_open_access: boolean;
  
  // 研究方向标签（最多 3 个）
  topics: { name_zh: string; confidence: number }[];
  
  // AI 解读（如果有）
  ai_analysis?: {
    summary_zh: string;
    background: string;
    method: string;
    value: string;
  };
  
  // 推荐来源（未来由算法填充，当前全部为 'precision'）
  source_type: 'precision' | 'trending' | 'serendipity';
  recommendation_reason?: string;
}
```

**当前占位实现逻辑（极简）：**

```sql
-- 这就是 Trae 当前需要实现的查询，极简版
SELECT p.*
FROM papers p
JOIN paper_research_topics prt ON prt.paper_id = p.id
JOIN research_topics rt ON rt.id = prt.topic_id
JOIN user_topic_subscriptions uts ON uts.topic_id = rt.id AND uts.user_id = :user_id
WHERE p.is_ai_med = true
  AND (:top_only = false OR p.quality_tier IN ('top', 'core'))
  AND p.quality_score >= :min_score
ORDER BY p.quality_score DESC
LIMIT :pageSize OFFSET :offset
```

如果用户没有设置任何订阅（新用户冷启动），退化为：
```sql
SELECT * FROM papers 
WHERE is_ai_med = true 
ORDER BY quality_score DESC 
LIMIT :pageSize
```

#### P2：推荐结果写入接口（预留给算法工程师）

创建一个服务端函数，算法工程师未来会调用它：

```typescript
// 文件：src/lib/recommendation-engine.ts

interface RecommendationInput {
  user_id: string;
  batch_date: string;  // YYYY-MM-DD
}

interface RecommendationOutput {
  paper_id: string;
  source_type: 'precision' | 'trending' | 'serendipity';
  recommendation_score: number;
  reason: string;
}

/**
 * 生成用户的推荐列表
 * 
 * 当前实现：极简版（按 quality_score 取 Top 20）
 * 未来：由算法工程师替换内部逻辑，实现黄金配比
 * 
 * 约定：
 * - 输出写入 feed_recommendations 表
 * - source_type 分三类：precision / trending / serendipity
 * - 当前全部标记为 precision
 */
export async function generateRecommendations(
  input: RecommendationInput
): Promise<RecommendationOutput[]> {
  // TODO: 算法工程师替换此处逻辑
  // 当前占位：直接按 quality_score 排序取 Top 20
}
```

#### P3：首页展示适配

- 未登录用户：展示全局 Top 文献（按 quality_score DESC）
- 已登录 + 无订阅：同上 + 提示"去设置页配置订阅"
- 已登录 + 有订阅：展示个性化推荐结果
- 每篇文献卡片显示 source_type 标签：
  - precision → 不显示标签（默认）
  - trending → 显示 "🔥 全局热点" 标签
  - serendipity → 显示 "💡 跨界推荐" 标签

### 关键注意事项

1. **接口先行，逻辑极简**：所有 TypeScript 接口（type/interface）要定义清晰，内部实现可以是最简单的 SQL 查询
2. **不要实现混排算法**：`source_type` 当前全部填 `'precision'`，`recommendation_score` 当前直接用 `quality_score`
3. **`feed_recommendations` 表的写入走 service_role**：前端只读
4. **`user_topic_subscriptions` 的读写走用户自己的 auth**：RLS 已配置好
5. **代码中所有 `paper_topics` 引用必须清理**：表已被物理删除，残留引用会导致运行时报错

### 完成后确认
- [ ] /settings 页面有订阅偏好配置 UI
- [ ] 订阅 API（GET + PUT）可用
- [ ] Feed API 支持按用户偏好过滤
- [ ] recommendation-engine.ts 骨架文件存在，接口定义完整
- [ ] 所有 paper_topics 引用已清理
- [ ] npm run build 通过
