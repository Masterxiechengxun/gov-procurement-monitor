# CCGP 爬虫运营手册

本文档面向日常运维人员，涵盖：首次部署后的功能验证流程、日常运营操作、故障排查方法。

---

## 一、首次部署后验证流程

完成 README.md 中的部署步骤后，按以下顺序在**微信开发者工具**的「云函数本地调试」面板依次验证。

> **打开本地调试面板**：微信开发者工具 → 工具栏「云开发」→ 「云函数」→ 选择函数 → 「本地调试」→「开启调试」

---

### 验证步骤 1：crawl 函数基础抓取（指定参数）

**调用参数：**
```json
{
  "manual": true,
  "kw": "耗材",
  "region": "四川",
  "start_time": "2026-03-07",
  "end_time": "2026-03-14"
}
```

**预期控制台输出（关键日志）：**
```
[Crawl] 开始执行, 手动触发=true
[Crawl] 中国政府采购网 使用 start_time=2026-03-07
[CCGP] 正在抓取第1页
[CCGP] 总页数=X，实际抓取上限=Y
[CCGP] 第1页获取 N 条
[Crawl] 去重后新增 M 条
[Crawl] 执行完成
```

**验证通过条件：**
- 日志中有 `总页数=X` 说明分页解析正常
- `新增 M 条` 中 M > 0（若数据库已有相同时间段数据则 M 可能为 0，属正常）
- 没有 `CCGP反爬拦截` 警告（若有，等待 10 分钟后重试）

**若失败：**
- 出现 `CCGP反爬拦截`：当前 IP 被临时限制，等待 10-30 分钟后重试
- 出现 `第1页失败`：检查网络或 CCGP 网站是否可访问

---

### 验证步骤 2：crawl 函数非默认省份（广东）

验证 ZONE_MAP 动态切换是否正常。

**调用参数：**
```json
{
  "manual": true,
  "kw": "耗材",
  "region": "广东",
  "start_time": "2026-03-07",
  "end_time": "2026-03-14"
}
```

**验证通过条件：**
- 调试面板的 Network 请求（或 console 日志）中，请求 URL 含 `zoneId=44`
- 写入数据库的记录中，`region` 字段值为 `"广东"` 而非 `"四川"`

**如何在数据库中确认：**
云开发控制台 → 数据库 → `procurements` → 筛选 `region = "广东"` → 确认有新记录且时间戳为刚才。

---

### 验证步骤 3：crawl 函数智能日期检测（不传 start_time）

验证 `detectStartDate` 是否能从存量数据中读取最新日期。

**前提：** 步骤 1 已写入至少 1 条数据。

**调用参数：**
```json
{
  "manual": true,
  "kw": "耗材",
  "region": "四川"
}
```

**预期控制台输出（关键日志）：**
```
[Crawl] detectStartDate(ccgp): 存量最新日期=YYYY-MM-DD
[Crawl] 中国政府采购网 使用 start_time=YYYY-MM-DD
```

**验证通过条件：**
- `start_time` 使用的日期与步骤 1 写入记录中最新的 `publishDate` 一致
- 而不是系统默认的「今日 -7 天」

**若日志显示「无存量数据，使用默认」：**
说明步骤 1 的写入未成功，或 `publishDate` 字段为空，需先排查步骤 1。

---

### 验证步骤 4：数据库记录字段完整性检查

在云开发控制台 → 数据库 → `procurements`，打开步骤 1 写入的最新记录，逐一确认字段：

| 字段 | 预期值 | 说明 |
|------|--------|------|
| `title` | 非空字符串 | 公告标题 |
| `url` | `http://` 开头 | 必须是完整 URL |
| `source` | `"ccgp"` | 来源标识 |
| `kw` | `"耗材"` | 抓取时使用的关键字 |
| `region` | `"四川"` | 地区（来自 ZONE_MAP） |
| `publishDate` | `YYYY-MM-DD` 格式 | 公告发布日期 |
| `contentHtml` | `null` | 第一阶段为空，等待 fetchDetail 补充 |
| `fetchRetryCount` | `0` | 初始重试次数 |
| `detailFetchedAt` | `null` | 初始未抓取详情 |
| `crawledAt` | Date 类型时间戳 | 入库时间 |
| `isChemical` | `true` 或 `false` | 关键字匹配结果 |
| `matchedKeywords` | 数组（可为空） | 命中的关键字列表 |

若 `isChemical` 缺失，说明 index.js 中的 `tagItemWithKeywords`/`matchItem` 调用有问题，需检查用户配置是否存在。

---

### 验证步骤 5：fetchDetail 端到端链路

**前提：** 步骤 1 已成功写入至少 1 条 `contentHtml: null` 的记录。

**调用参数：**
```json
{
  "batchSize": 3
}
```

**预期控制台输出：**
```
[FetchDetail] 开始执行, batchSize=3
[FetchDetail] 本批处理 3 条（或更少）
[FetchDetail] 完成: {"processed":X,"succeeded":Y,"failed":Z,"abandoned":0}
```

**验证通过条件：**
- `succeeded` > 0，说明至少有 1 条记录成功补抓了原文 HTML
- 在数据库面板查看该记录：`contentHtml` 变为非空 HTML 字符串，`detailFetchedAt` 有时间戳

**若 succeeded = 0：**
- 检查 `failed` 原因（日志中有失败 URL 和错误原因）
- CCGP 详情页 URL 的 IP 限制比搜索页更严，可能需要更长等待时间

---

### 验证步骤 6：fetchDetail 重试放弃路径（FETCH_FAILED）

验证达到最大重试次数后记录被正确放弃。

**手动插入测试记录：**
在云开发控制台 → 数据库 → `procurements` → 「添加记录」，填入：
```json
{
  "title": "测试放弃路径（可删除）",
  "url": "http://invalid.ccgp.gov.cn/nonexistent-test-12345.htm",
  "source": "ccgp",
  "contentHtml": null,
  "fetchRetryCount": 4,
  "crawledAt": "（选择当前时间）"
}
```

**调用 fetchDetail（batchSize=1）：**
```json
{
  "batchSize": 1
}
```

**验证通过条件：**
- 该记录的 `contentHtml` 变为 `"FETCH_FAILED"`（4+1=5 >= MAX_RETRY_COUNT）
- `fetchRetryCount` 变为 `5`
- 再次调用 fetchDetail，该记录不再被捞出（已不满足 `fetchRetryCount < 5`）

**清理：** 验证完成后在数据库面板删除该测试记录。

---

## 二、日常运营操作

### 手动触发一次完整抓取

适用于：定时器意外跳过、需要立即补抓数据的情况。

**第一步：触发 crawl 获取最新列表**
在小程序「设置」→「手动抓取」，或在云开发控制台 → 云函数 → crawl → 「测试」，传入：
```json
{
  "manual": true
}
```
此时 `start_time` 由 `detectStartDate` 自动决定（从存量最新日期开始）。

**第二步：触发 fetchDetail 补充原文**
等待约 1 分钟后（确保 crawl 写入完成），调用 fetchDetail：
```json
{
  "batchSize": 8
}
```
若有大量记录待补抓，可多次调用（每次处理 8 条）。

---

### 指定时间段重新抓取

适用于：某段历史数据缺失，需要补录。

在云函数测试面板传入明确时间范围：
```json
{
  "manual": true,
  "kw": "耗材",
  "region": "四川",
  "start_time": "2026-02-01",
  "end_time": "2026-02-28"
}
```

注意：已存在的 URL 会被去重跳过，不会重复入库。

---

### 修改抓取关键字和地区

以下参数均通过 crawl 的 event 传入：

| 参数 | 说明 | 示例 |
|------|------|------|
| `kw` | 关键字（用于 CCGP 搜索过滤） | `"医疗器械"` |
| `region` | 省份简称（31 省均支持） | `"北京"`、`"广东"`、`"四川"` |
| `start_time` | 开始日期（YYYY-MM-DD） | `"2026-03-01"` |
| `end_time` | 结束日期（YYYY-MM-DD） | `"2026-03-15"` |
| `maxPages` | 最大抓取页数（默认 15） | `5` |

定时任务自动触发时，这些参数从云数据库用户配置读取（`kw` 和 `region` 来自用户设置页）。

---

### 查看抓取日志

在云开发控制台 → 数据库 → `crawl_log`，每次抓取完成后会写入一条日志记录，包含：

| 字段 | 说明 |
|------|------|
| `date` | 日期（YYYY-MM-DD） |
| `totalFound` | 本次抓取条目总数 |
| `newItems` | 去重后新增条目数 |
| `matchedItems` | 命中关键字的条目数 |
| `errors` | 错误列表（各来源） |
| `sourceDetails` | 各来源详情（成功/失败/条目数） |
| `duration` | 执行耗时（毫秒） |

---

## 三、故障排查

### 故障：crawl 反爬拦截

**症状：** 日志出现 `CCGP反爬拦截：云函数IP被限制访问`

**原因：** CCGP 网站对频繁访问的 IP 做临时封锁（通常 10-30 分钟）。

**处理方式：**
1. 等待 10-30 分钟后重试
2. 若持续出现，减少 `maxPages`（如从 15 改为 5）降低请求频率
3. 检查是否有其他函数实例同时在抓取 CCGP

---

### 故障：fetchDetail 大量 failed

**症状：** fetchDetail 执行后 `succeeded=0`，`failed` 数量较多

**可能原因和处理：**

| 原因 | 诊断方式 | 处理 |
|------|----------|------|
| 详情页 IP 被限 | 日志出现「反爬拦截」 | 等待 30 分钟后重试 |
| 公告 URL 已失效 | 手动访问 URL 确认 | 正常现象，fetchRetryCount 会累加到 5 后标记 FETCH_FAILED |
| 网络超时 | 日志出现 timeout 错误 | 调大 axios timeout（当前 5000ms） |
| CCGP 改版 | 日志出现「无法提取内容」 | 更新 `CONTENT_SELECTORS` 列表 |

---

### 故障：detectStartDate 始终返回 7 天前

**症状：** 即使有存量数据，日志仍显示「无存量数据，使用默认」

**排查步骤：**
1. 在数据库中确认 `procurements` 集合中有 `source = "ccgp"` 的记录
2. 确认这些记录的 `publishDate` 字段存在且格式为 `YYYY-MM-DD`
3. 若 `publishDate` 为空字符串或格式异常，需检查 ccgp.js 的 `parseMetaText` 日期解析逻辑

---

### 故障：fetchDetail 查不到待处理记录

**症状：** fetchDetail 总是输出「无待处理记录」

**可能原因：**

| 原因 | 检查方式 |
|------|----------|
| crawl 未成功写入数据 | 数据库中查看 `procurements` 是否有新记录 |
| 记录的 `contentHtml` 不是 `null` 而是 `undefined` | 在数据库面板查看字段类型 |
| 记录的 `fetchRetryCount` 已 >= 5 | 该记录被放弃，不再查询 |

**注意：** 微信云数据库中 `null` 和字段缺失（undefined）是不同的。fetchDetail 查询条件是 `contentHtml: null`，只有明确设置为 `null` 的记录才会被查到。新设计的 ccgp.js 已正确设置 `contentHtml: null`。

---

## 四、数据库维护

### 手动清理测试数据

在云开发控制台 → 数据库 → `procurements`，可通过以下条件筛选并删除测试记录：
- `source = "ccgp"` 且 `title` 包含「测试」

### 重置某条记录的 fetchRetryCount

若某条记录因网络问题被标记为 `FETCH_FAILED`，但实际 URL 有效，可手动重置：
1. 在数据库面板找到该记录
2. 编辑字段：`contentHtml = null`，`fetchRetryCount = 0`
3. 下次 fetchDetail 运行时会自动重新尝试

### 数据库索引

`procurements` 集合建议维护的索引（在云控制台手动创建）：

| 字段 | 方向 | 用途 |
|------|------|------|
| `url` | 升序 | crawl 去重查询 |
| `contentHtml` | 升序 | fetchDetail 查询空值记录 |
| `crawledAt` | 升序 | fetchDetail 按入库时间排序 |

---

## 五、云函数配置参考

### crawl 函数关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `kw` | `"耗材"` | CCGP 搜索关键字 |
| `region` | `"四川"` | 省份简称（对应 ZONE_MAP） |
| `timeType` | `"2"` | CCGP 时间类型（2=发布时间） |
| `maxPages` | `15` | 最大翻页数（约 45 秒内） |
| `start_time` | 自动检测 | YYYY-MM-DD 格式，未传时由 detectStartDate 决定 |
| `end_time` | 今日 | YYYY-MM-DD 格式 |

### fetchDetail 函数关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `batchSize` | `8` | 每次处理记录数（受 60s 超时限制） |

**超时估算：** `batchSize × (5s超时 + 0.8s间隔) ≈ 46s`，安全范围内。

### 支持的省份列表（ZONE_MAP）

| 省份 | zoneId | 省份 | zoneId | 省份 | zoneId |
|------|--------|------|--------|------|--------|
| 北京 | 11 | 河南 | 41 | 四川 | 51 |
| 天津 | 12 | 湖北 | 42 | 贵州 | 52 |
| 河北 | 13 | 湖南 | 43 | 云南 | 53 |
| 山西 | 14 | 广东 | 44 | 西藏 | 54 |
| 内蒙古 | 15 | 广西 | 45 | 陕西 | 61 |
| 辽宁 | 21 | 海南 | 46 | 甘肃 | 62 |
| 吉林 | 22 | 重庆 | 50 | 青海 | 63 |
| 黑龙江 | 23 | — | — | 宁夏 | 64 |
| 上海 | 31 | — | — | 新疆 | 65 |
| 江苏 | 32 | 安徽 | 34 | — | — |
| 浙江 | 33 | 福建 | 35 | 山东 | 37 |
| 江西 | 36 | — | — | — | — |

> **未知省份 fallback**：若传入的 region 不在 ZONE_MAP 中，自动降级为「四川」。
