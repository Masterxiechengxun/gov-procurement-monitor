# CCGP 政府采购爬虫重设计

**日期：** 2026-03-15
**完成日期：** 2026-03-16
**状态：** 已完成（架构已调整，见下方说明）

---

## 最终架构说明

原规划为两阶段架构（crawl 抓列表 + fetchDetail 补充 HTML）。实际实现时，第二阶段改为在小程序内使用 `<web-view>` 直接加载原始公告 URL，**fetchDetail 云函数未实现**。

原因：
- web-view 方案无需额外云函数和存储开销
- 规避了反爬限制、HTML 存储上限、字段污染等问题
- 个人类型小程序支持 web-view（限企业类型不可用的场景已确认不影响本项目）

因此数据结构中不包含 `contentHtml`、`fetchRetryCount`、`detailFetchedAt` 字段。存量数据库中若有这些旧字段，由 `clean` 云函数的 `cleanStaleFields()` 函数批量清除。

---

## 背景与问题（原始）

现有 `cloudfunctions/crawl/crawlers/ccgp.js` 存在以下问题：

1. `timeType` 使用 `"6"`，应为 `"2"`（按公告时间段搜索）
2. `pinMu` 使用 `"1"`，应为 `"0"`（全部类别）
3. `bidType` 未设置，应为 `"0"`（全部类型）
4. `displayZone` 使用 `"四川省"`，应为 `"四川"`，且不支持动态传入
5. `zoneId` 硬编码在 sources.js 中，不可动态传入
6. 不支持关键字 `kw` 参数（默认应为"耗材"）
7. 翻页依赖固定 `maxPages=5`，未读取分页器实际总页数
8. 每次爬取时间范围固定使用 -3 天，未根据存量数据自动调整

---

## 目标

- 正确抓取中国政府采购网（search.ccgp.gov.cn）指定地区指定关键字的采购公告列表
- 支持三个可配置搜索条件（通过设置页 / event 参数传入）：
  - **关键字**（kw）：默认"耗材"
  - **地区**（region）：默认"四川"，动态映射为 `displayZone` + `zoneId`
  - **时间范围**：自动根据存量数据智能决定
- 智能起始日期：DB 无数据时默认最近 7 天；有数据时从存量最新 `publishDate` 开始
- 动态读取分页器，抓取全部页（安全上限 15 页）
- 详情页通过 `<web-view>` 直接展示原始网页（非本地存储 HTML）
- 支持定时自动 + 手动触发两种模式
- 新增数据与存量数据正确去重

---

## 架构

```
crawl 云函数（列表抓取）        小程序 detail 页
 ┌──────────────────┐              ┌────────────────────────┐
 │ 接收 event 参数  │              │ <web-view src="{{url}}">│
 │ 构造搜索 URL     │  --> DB -->  │ cover-view 自定义导航栏 │
 │ 动态翻页抓列表   │              │ 直接渲染原始公告网页    │
 │ URL 去重入库     │              └────────────────────────┘
 └──────────────────┘
   定时（每天06:00）+ 手动触发
```

---

## 详细设计

### 一、`ccgp.js` 改造（已完成）

#### 1.1 URL 参数修正

| 参数 | 旧值 | 新值 | 说明 |
|------|------|------|------|
| `timeType` | `"6"` | `"2"` | 按公告时间段搜索 |
| `pinMu` | `"1"` | `"0"` | 全部类别 |
| `bidType` | 未设置 | `"0"` | 全部类型 |
| `displayZone` | `"四川省"` 硬编码 | 动态从 `region` 映射 | 通过 ZONE_MAP 查表 |
| `zoneId` | `"51"` 硬编码 | 动态从 `region` 映射 | 通过 ZONE_MAP 查表 |
| `kw` | 未支持 | 动态传入 | 默认"耗材" |

**地区参数：** `ccgp.js` 内维护 `ZONE_MAP`，将省份简称映射为 CCGP 接口参数，覆盖全国 30 个省级行政区。未知省份 fallback 到"四川"。

**日期参数格式：** event 层传 `YYYY-MM-DD`；`ccgp.js` 内部构造请求时将 `-` 替换为 `%3A`，发送 `YYYY%3AMM%3ADD`。

#### 1.2 动态分页

从响应 HTML 解析 `.pager` 标签，优先匹配"共 X 页"文字，备用取分页链接最大数字。实际翻页上限 `Math.min(totalPages, maxPages)`，`maxPages` 默认 15。

#### 1.3 入库数据结构（已实现）

```js
{
  title:            string,   // 公告标题
  url:              string,   // 详情页 URL（去重依据）
  source:           string,   // "ccgp"
  sourceName:       string,   // "中国政府采购网"
  publishDate:      string,   // "YYYY-MM-DD"
  region:           string,   // 地区（来自 ZONE_MAP.displayZone）
  buyer:            string,   // 采购人
  agent:            string,   // 代理机构
  bidType:          string,   // 公告类型
  kw:               string,   // 本次搜索使用的关键字
  isChemical:       boolean,  // 是否命中用户关键字
  matchedKeywords:  string[], // 命中的关键字列表
  crawledAt:        Date      // 列表抓取时间
}
```

> **注意：** 原规划中的 `contentHtml`、`fetchRetryCount`、`detailFetchedAt` 字段**不在此结构中**。

#### 1.4 智能起始日期（`detectStartDate`，已实现）

位于 `crawl/index.js`。每次执行时若 `event.start_time` 未显式传入，则自动查询该来源存量数据的最新 `publishDate`：
- DB 无记录：返回今日 -7 天
- DB 有记录且格式合法：返回最新 `publishDate`
- DB 有记录但格式异常（非 `YYYY-MM-DD`）：fallback 到今日 -7 天并打 warning

---

### 二、`crawl/index.js` 改造（已完成）

- `checkSchedule()` 精简：移除 `intervalHours` / `isMatchingHour()` / 最小间隔检查，只检查 `enabled` + `dayType`
- `executeCrawl(crawlOptions)` 接收并透传 event 参数（kw / region / start_time / end_time / timeType / maxPages）
- 对每个来源独立调用 `detectStartDate`，结果注入 `sourceOptions`

---

### 三、设置 UI 精简（已完成）

原两区块设计（「系统触发器」+「执行控制」）合并为单一「自动抓取」卡片：
- 去除「系统触发器」只读显示区块
- 去除「抓取间隔」picker（触发器已固定为每天，小时粒度无意义）
- 保留「启用」开关 + 「运行日期」picker（每天 / 仅工作日 / 仅周末）
- 底部摘要文字实时反映当前策略

---

### 四、`clean` 函数新增 `cleanStaleFields()`（已完成）

`cleanStaleFields()` 函数：查询 `procurements` 中含 `contentHtml` 字段（`_.exists(true)`）的记录，批量移除 `contentHtml` / `fetchRetryCount` / `detailFetchedAt` 三个废弃字段（`_.remove()`）。在每次 clean 执行的 `cleanOldLogs()` 之后调用。

---

## 文件变更列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `cloudfunctions/crawl/config/sources.js` | 修改 | 修正 pinMu / bidType；移除 displayZone / zoneId |
| `cloudfunctions/crawl/crawlers/ccgp.js` | 修改 | ZONE_MAP、region 参数、动态分页、日期编码内化；移除废弃字段 |
| `cloudfunctions/crawl/index.js` | 修改 | 透传 crawlOptions；新增 `detectStartDate()`；精简 `checkSchedule()` |
| `cloudfunctions/crawl/config.json` | 修改 | 触发器改为每天 06:00（`0 0 6 * * * *`） |
| `cloudfunctions/getData/index.js` | 修改 | `DEFAULT_SCHEDULE` 移除 intervalHours；keyword 搜索加正则转义 |
| `cloudfunctions/clean/index.js` | 修改 | 新增 `cleanStaleFields()` |
| `miniprogram/pages/settings/settings.js` | 修改 | 移除 intervalOptions / intervalHours；精简 loadSchedule |
| `miniprogram/pages/settings/settings.wxml` | 修改 | 替换为单区块自动抓取卡片 |
| `miniprogram/pages/settings/settings.wxss` | 修改 | 移除两区块相关样式 |
| `miniprogram/pages/detail/detail.wxml` | 修改 | 改为 web-view + cover-view 自定义导航栏 |
| `miniprogram/pages/index/index.wxss` | 修改 | 底部 padding 修复 tab bar 遮挡；分页加载样式 |
| `miniprogram/pages/index/index.wxml` | 修改 | 加载中文字 + "没有更多了"提示 |
| `miniprogram/pages/index/index.js` | 修改 | loadList 分页列表用 slice() 拷贝 |
| `miniprogram/pages/stats/stats.wxss` | 修改 | 底部 padding 修复 tab bar 遮挡 |
| `miniprogram/pages/stats/stats.wxml` | 修改 | 移除监控源卡片 |
| `miniprogram/pages/stats/stats.js` | 修改 | 移除 activeSources |

---

## 未实现部分

| 原规划项 | 状态 | 说明 |
|----------|------|------|
| `fetchDetail` 云函数 | **不实现** | 改为 web-view 方案，无需本地存储 HTML |
| `contentHtml` / `fetchRetryCount` / `detailFetchedAt` 字段 | **不入库** | 字段不存在于当前数据结构；存量中如有则由 clean 清除 |
| `procurements.contentHtml` 索引 | **不需要** | fetchDetail 不存在 |
| `procurements.crawledAt` 升序索引 | **不需要** | fetchDetail 不存在 |

---

## 约束与风险

- **反爬限制**：CCGP 对高频访问有拦截，列表翻页间隔保持 500ms
- **crawl 超时**：默认 maxPages=15，预估最坏耗时约 52.5s（15 × 3.5s），在 60s 内
- **每日触发**：触发器固定 06:00，策略只控制「是否执行」，不影响触发时间
