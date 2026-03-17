# 微信推送通知重新设计

**日期**: 2026-03-16
**状态**: 待用户确认
**涉及文件**: `cloudfunctions/crawl/utils/notifier.js`, `cloudfunctions/crawl/index.js`

---

## 背景

系统每日自动抓取招标信息后，通过 PushPlus 向用户的微信公众号推送通知。现有推送存在以下问题：

1. **成功通知缺少来源汇总** — 仅逐条展示，无法快速了解各网站新增数量
2. **错误通知是技术报错** — 原始异常信息用户无法理解
3. **成功+错误分两条消息** — 体验割裂，用户不清楚结果是否完整
4. **没有行动指引** — 抓取失败时未告知用户去哪里手动查看

---

## 目标

- 成功通知顶部展示来源汇总（各网站命中条数）
- 错误通知使用友好文案，附上网站直链供用户手动查看
- 有结果 + 有错误时，合并为一条消息推送
- 仅修改 `notifier.js` 和 `index.js`，不触碰爬虫、配置、数据库逻辑

---

## 消息内容设计

所有消息使用 PushPlus 的 `template: "html"` 模板，与现有代码保持一致。

### 核心概念定义

`errorSources`：在 `buildReport` 内部计算，定义为：

```js
var errorSources = sourceDetails.filter(function(s) { return s.status !== "success"; });
```

即 `status === "error"` 或 `status === "partial"` 的来源列表，每个来源出现一次，不重复。

### 场景判断逻辑（在 `buildReport` 内部执行）

```
if userItems.length > 0 && errorSources.length === 0  → 场景 1：有命中，无错误
if userItems.length > 0 && errorSources.length > 0    → 场景 2：有命中 + 有错误
if userItems.length === 0 && errorSources.length > 0  → 场景 3：无命中，有错误
if userItems.length === 0 && errorSources.length === 0 → 返回 null（外层跳过推送）
```

`buildReport` 当场景 4 时返回 `null`。`sendNotification` 在调用 `buildReport` 后，若返回值为 `null`，直接返回 `Promise.resolve({ skipped: true })`，不调用 `doSend`。

### 场景 1：有命中结果，无错误

**消息标题**: `今日新增 {userItems.length} 条设备采购信息`

**消息内容**:

```html
<h3>今日设备采购信息 · 共 {userItems.length} 条</h3>
<p style="color:#666;font-size:12px;">{buildSourceSummary(userItems)}</p>
<p style="color:#666;font-size:12px;">推送时间：{当前北京时间}</p>
<hr/>

<!-- 对每条 item 循环 -->
<div style="margin-bottom:15px;">
  <p><b>{序号}. {item.title}</b></p>
  <p style="color:#666;font-size:12px;">来源：{item.sourceName} | 日期：{item.publishDate}</p>
  <!-- 仅当 item.buyer 或 item.region 存在时展示 -->
  <p style="color:#666;font-size:12px;">采购人：{item.buyer} | 地区：{item.region}</p>
  <!-- 仅当 item.matchedKeywords.length > 0 时展示 -->
  <p style="color:#FF3B30;font-size:12px;">匹配关键字：{item.matchedKeywords.join(", ")}</p>
  <p><a href="{item.url}" style="color:#2B5CE6;">点击查看原文 →</a></p>
</div>
<hr/>
<!-- 循环结束 -->

<p style="color:#999;font-size:11px;">由采购信息监控系统自动推送</p>
```

### 场景 2：有命中结果 + 部分网站失败

**消息标题**: `今日新增 {userItems.length} 条设备采购信息（{errorSources.length} 个网站异常）`

**消息内容**：条目列表（同场景 1 格式）+ 尾部错误警告区块：

```html
<!-- 条目列表部分同场景 1 -->
<hr/>
<h4 style="color:#FF8C00;">注意：以下网站今日数据可能不完整，建议手动补查</h4>

<!-- 对 errorSources 每条循环 -->
<p><b>❌ {sd.sourceName}</b></p>
<p style="color:#666;font-size:12px;">原因：{getFriendlyError(sd.errorMessage)}</p>
<p><a href="{source.website}" style="color:#2B5CE6;">手动查看 →</a></p>
<!-- 循环结束 -->
<hr/>

<p style="color:#999;font-size:11px;">由采购信息监控系统自动推送</p>
```

其中 `source.website` 通过 `sources.getSourceById(sd.sourceId).website` 获取；若查询结果为 `null`（未知来源），则不渲染链接行。

### 场景 3：无命中结果 + 有网站失败

**触发条件**: `userItems.length === 0 && errorSources.length > 0`

包含两种情况：所有来源均失败、或部分失败但无用户关注词命中。

**消息标题**: `今日自动抓取未完成，请手动查看`

**消息内容**:

```html
<h3 style="color:#FF3B30;">今日设备采购信息自动抓取未完成</h3>
<p style="color:#666;font-size:12px;">推送时间：{当前北京时间}</p>
<p>以下网站访问失败，今日数据可能有遗漏，<br/>
为避免耽误工作，建议手动前往查看：</p>
<hr/>

<!-- 对 errorSources 每条循环，同场景 2 的错误区块格式 -->
<p><b>❌ {sd.sourceName}</b></p>
<p style="color:#666;font-size:12px;">原因：{getFriendlyError(sd.errorMessage)}</p>
<p><a href="{source.website}" style="color:#2B5CE6;">手动查看 →</a></p>
<!-- 循环结束 -->
<hr/>

<p style="font-size:12px;">
  本次运行摘要：共抓取 {stats.total} 条，新增 {stats.newItems} 条
  <!-- 仅当 stats.newItems > 0 时追加 -->（无关键字命中）
</p>
<p style="color:#999;font-size:11px;">由采购信息监控系统自动推送</p>
```

摘要行逻辑：
- 若 `stats.newItems > 0`：显示"共抓取 N 条，新增 M 条（无关键字命中）"
- 若 `stats.newItems === 0`：显示"共抓取 N 条，新增 0 条"

### 场景 4：无命中结果，无错误

`buildReport` 返回 `null`，`sendNotification` 不调用 `doSend`。此为设计意图，非遗漏。

---

## 错误信息友好化映射

`getFriendlyError(rawMessage)` 接受 `sourceDetail.errorMessage` 字符串（非 `errors[i].message` 明细条目）。

匹配规则（按顺序，不区分大小写，首次命中即返回）：

| 匹配关键字 | 用户看到的原因 |
|---|---|
| `timeout` / `etimedout` | 网站访问超时（可能是网络波动或网站访问量过大） |
| `econnrefused` | 网站拒绝连接（可能正在维护中） |
| `enotfound` | 域名无法解析（本地网络或 DNS 异常） |
| `403` / `forbidden` | 访问被拒绝（网站可能限制了自动化访问） |
| `404` / `not found` | 页面不存在（网站结构可能已更新） |
| `500` / `502` / `503` | 网站服务器异常（可能正在维护或过载） |
| `页请求失败` | 部分页面抓取失败（网站响应不稳定，数据可能不完整） |
| 其他 | 网站访问异常（原因未知，建议稍后再试） |

---

## `buildSourceSummary` 规格

**签名**: `buildSourceSummary(userItems)`

**功能**: 按 `item.sourceName` 分组统计 `userItems` 的条数，返回汇总字符串。

**边界情况**:
- `userItems` 为空：返回空字符串 `""`
- 仅一个来源：返回 `"中国政府采购网 3 条"`（无 ` · ` 分隔符）
- `item.sourceName` 为空字符串或 `undefined`：归入 `"未知来源"` 分组

---

## 架构改动

### notifier.js

**删除**:
- `buildHtmlMessage(items)`
- `buildErrorMessage(sourceDetails, errors, stats)`
- `sendErrorNotification(token, sourceDetails, errors, stats)`

**新增（对外导出，供外部测试使用）**:

- `getFriendlyError(rawMessage)` — 错误信息友好化映射
- `buildSourceSummary(userItems)` — 来源条数汇总
- `buildReport(userItems, sourceDetails, stats)` — 统一消息构建，返回 `{ title, content }` 或 `null`

**`buildReport` 的完整参数定义**:

- `userItems`: 数组，每条含 `{ title, sourceName, publishDate, buyer, region, matchedKeywords, url }`
- `sourceDetails`: 数组，每条含 `{ sourceId, sourceName, status, errorMessage }`。`sourceId` 用于查询 `website` 直链，`errorMessage` 用于友好化映射
- `stats`: 对象 `{ total, newItems }`（`total`=本次抓取总条数，`newItems`=新入库条数）

`buildReport` 内部通过 `require('../config/sources').getSourceById(sd.sourceId)` 获取 `website` 字段。

**修改**:

`sendNotification(token, items)` → `sendNotification(token, userItems, sourceDetails, stats)`

新函数逻辑：
```
1. if (!token) return Promise.resolve({ success: true, skipped: true })
2. var report = buildReport(userItems, sourceDetails, stats)
3. if (report === null) return Promise.resolve({ success: true, skipped: true })
4. return doSend(token, report.title, report.content)
```

旧的前置守卫（`if (!items || items.length === 0) return`）删除，场景过滤由 `buildReport` 的返回值控制。

**保留不变**:
- `doSend(token, title, content)`
- `escapeHtml(str)`

**最终 `module.exports`**:
```js
module.exports = {
    sendNotification: sendNotification,    // 主推送入口（签名已更新）
    buildReport: buildReport,              // 导出供单元测试
    buildSourceSummary: buildSourceSummary, // 导出供单元测试
    getFriendlyError: getFriendlyError      // 导出供单元测试
};
```

### index.js

**删除**:
- `sendNotifications(results, userMap)` — 含对旧版 `notifier.sendNotification(token, userItems)` 的调用
- `sendErrorNotifications(results, userMap)` — 含对 `notifier.sendErrorNotification(token, ...)` 的调用

删除后，`index.js` 中不再有任何对 `notifier.sendErrorNotification` 的引用。

**新增**:
- `sendAllNotifications(results, userMap)`

**`sendAllNotifications` 完整逻辑**:

```
var stats = { total: results.total, newItems: results.newItems };

对每个用户（uid, config）：
  1. var token = config["pushplus_token"]
     if (!token) → 跳过

  2. var userItems = filterItemsByUserKeywords(
       results._matchedNewItems || [], config["custom_keywords"]
     )

  3. // 预检场景 4，避免无意义调用（buildReport 内部也会做同样判断）
     var hasErrors = results.sourceDetails.some(function(s) {
       return s.status !== "success";
     });
     if (userItems.length === 0 && !hasErrors) → 跳过

  4. return notifier.sendNotification(token, userItems, results.sourceDetails, stats)
```

说明：`errorSources` 的过滤逻辑在 `sendAllNotifications` 和 `buildReport` 内部各自独立计算，两者职责分离（前者用于提前跳过，后者用于构建消息内容），这是有意设计。

**`executeCrawl` 调用链变更**:

```js
// 现在（两步串行）
.then(function() { return sendNotifications(crawlResults, allUsersConfig); })
.then(function() { return sendErrorNotifications(crawlResults, allUsersConfig); })

// 改后（一步）
.then(function() { return sendAllNotifications(crawlResults, allUsersConfig); })
```

---

## 不变的部分

- 所有爬虫实现（`crawlers/`）
- 数据库读写逻辑（`deduplicateAndSave`、`batchInsert` 等）
- 关键字匹配逻辑（`matcher.js`、`tagItemWithKeywords`）
- `filterItemsByUserKeywords` 函数
- 来源配置（`config/sources.js`）— 仅新增在 `notifier.js` 内部 require，不修改文件本身
- 调度策略（`checkSchedule`）
- 日志记录（`saveCrawlLog`）
