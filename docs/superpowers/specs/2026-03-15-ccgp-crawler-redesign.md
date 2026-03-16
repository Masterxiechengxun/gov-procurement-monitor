# CCGP 政府采购爬虫重设计

**日期：** 2026-03-15
**状态：** 待实现

---

## 背景与问题

现有 `cloudfunctions/crawl/crawlers/ccgp.js` 存在以下问题：

1. `timeType` 使用 `"6"`，应为 `"2"`（按公告时间段搜索）
2. `pinMu` 使用 `"1"`，应为 `"0"`（全部类别）
3. `bidType` 未设置，应为 `"0"`（全部类型）
4. `displayZone` 使用 `"四川省"`，应为 `"四川"`
5. 不支持关键字 `kw` 参数（默认应为"耗材"）
6. 翻页依赖固定 `maxPages=5`，未读取分页器实际总页数
7. 只存列表元数据，不抓取每条公告的完整原文

---

## 目标

- 正确抓取中国政府采购网（search.ccgp.gov.cn）四川地区近一周的采购公告列表
- 支持关键字参数传入，默认关键字"耗材"
- 动态读取分页器，抓取全部页（设安全上限）
- 两阶段入库：第一阶段存列表元数据，第二阶段补充完整原文 HTML
- 支持定时自动 + 手动触发两种模式
- 新增数据与存量数据正确去重

---

## 架构

```
crawl 云函数（第一阶段）        fetchDetail 云函数（第二阶段）
 ┌──────────────────┐              ┌──────────────────────┐
 │ 接收 event 参数  │              │ 查询 contentHtml=null │
 │ 构造搜索 URL     │              │ 逐条 GET 详情页       │
 │ 动态翻页抓列表   │  --> DB -->  │ 提取主体 HTML         │
 │ URL 去重入库     │              │ 更新 contentHtml      │
 └──────────────────┘              └──────────────────────┘
   定时 + 手动触发                   定时 + 手动触发
```

---

## 详细设计

### 一、`ccgp.js` 改造

#### 1.1 URL 参数修正

| 参数           | 旧值       | 新值    | 说明               |
|----------------|------------|---------|-------------------|
| `timeType`     | `"6"`      | `"2"`   | 按公告时间段搜索   |
| `pinMu`        | `"1"`      | `"0"`   | 全部类别           |
| `bidType`      | 未设置     | `"0"`   | 全部类型           |
| `displayZone`  | `"四川省"` | `"四川"` | 匹配实际参数       |
| `kw`           | 未支持     | 动态传入 | 关键字，默认"耗材" |

**日期参数格式：**
- `event` 层（外部调用）传入明文 `YYYY-MM-DD` 格式（如 `"2026-03-07"`）
- `ccgp.js` 内部在构造 HTTP 请求时将 `-` 替换为 `:` 并经 `encodeURIComponent` 编码，最终发送 `YYYY%3AMM%3ADD`
- 若 `event` 未传，默认 `start_time` = 今日 -7 天，`end_time` = 今日，均以 `YYYY-MM-DD` 格式生成后同样编码

#### 1.2 动态分页

从响应 HTML 中解析 `<p class="pager">` 标签，提取总页数：

```js
function parseTotalPages($) {
  // 优先匹配 "共 X 页" 文字
  var text = $(".pager").text();
  var match = text.match(/共\s*(\d+)\s*页/);
  if (match) return parseInt(match[1]);
  // 备用：找 pager 中所有数字链接，取最大值
  var max = 1;
  $(".pager a").each(function() {
    var n = parseInt($(this).text().trim());
    if (!isNaN(n) && n > max) max = n;
  });
  return max;
}
```

实际翻页上限取 `Math.min(parseTotalPages($), maxPages)`。

**超时评估（maxPages=20 默认值）：**
- 每页最坏耗时：500ms 间隔 + 3s 请求 = 3.5s
- 20 页总耗时预估：20 × 3.5s = 70s，超出 60s 硬限制
- 因此 `maxPages` 默认值设为 **15**（15 × 3.5s ≈ 52.5s，留有余量）
- 手动触发时可通过 `event.maxPages` 调高，需由调用者自行承担超时风险

#### 1.3 crawl 方法参数

`crawl(options)` 接收（均为可选，未传时使用默认值）：

```js
{
  kw:         string,   // 单个关键字字符串，默认 "耗材"；传 "" 表示不限关键字（搜索全量）
  start_time: string,   // YYYY-MM-DD 明文，默认今日 -7 天
  end_time:   string,   // YYYY-MM-DD 明文，默认今日
  timeType:   string,   // 默认 "2"
  maxPages:   number    // 安全翻页上限，默认 15
}
```

**`kw` 说明：** 仅支持单个关键字字符串，对应 CCGP 搜索接口的 `kw` 参数。若调用方需要多个关键字，应多次调用云函数（每次传不同 `kw`），不支持在单次调用中传入多个关键字。存入数据库的 `kw` 字段记录本次实际使用的搜索关键字。

#### 1.4 入库数据结构

```js
{
  title:            string,   // 公告标题
  url:              string,   // 详情页 URL（去重依据）
  source:           string,   // "ccgp"
  sourceName:       string,   // "中国政府采购网"
  publishDate:      string,   // "YYYY-MM-DD"
  region:           string,   // 地区
  buyer:            string,   // 采购人
  agent:            string,   // 代理机构
  bidType:          string,   // 公告类型
  kw:               string,   // 本次搜索使用的关键字
  isChemical:       boolean,  // 是否命中用户关键字（第一阶段填充，基于标题）
  matchedKeywords:  string[], // 命中的关键字列表（第一阶段填充）
  contentHtml:      null,     // 待 fetchDetail 填充；失败超限后设为 "FETCH_FAILED"
  fetchRetryCount:  0,        // fetchDetail 已重试次数
  crawledAt:        Date,     // 列表抓取时间
  detailFetchedAt:  null      // 详情抓取成功时间，待填充
}
```

**`isChemical` / `matchedKeywords` 填充说明：**
- 在第一阶段（`crawl`）列表入库时填充，基于标题文本
- 由 `crawl/index.js` 中现有的 `tagItemWithKeywords(item, mergedKeywords)` 函数处理（位于 `index.js` 第451行）
- 若数据库中无用户配置关键字，则 fallback 到 `crawler/utils/matcher.js` 中的 `matchItem(item)`

#### 1.5 去重实现

采用 **read-before-write** 方式（与现有代码一致，见 `index.js` 的 `batchCheckUrls`）：

1. 取本次抓取所有 URL，分批（每批20条）查询 `procurements` 集合
2. 过滤掉已存在的 URL，仅对新 URL 调用 `db.collection("procurements").add()`
3. 并发风险说明：定时触发与手动触发若恰好同时执行，理论上可能对同一条 URL 双写。微信云数据库无唯一索引约束，双写会产生重复记录。缓解措施：依赖现有 `checkSchedule` 中的"距上次抓取间隔"检查——定时触发之间间隔大于 0.5h，手动触发不受限制但概率极低。可接受极低概率的重复记录，不额外引入分布式锁机制（复杂度与收益不匹配）。

---

### 二、新建 `fetchDetail` 云函数

#### 2.1 目录结构

```
cloudfunctions/
  fetchDetail/
    index.js
    package.json
    config.json
```

`config.json` 内容（微信云函数标准格式）：
```json
{
  "permissions": {
    "openapi": []
  }
}
```

#### 2.2 执行逻辑

1. 查询 `procurements` 集合中 `contentHtml == null` 且 `fetchRetryCount < 5` 的记录，按 `crawledAt` 升序，每批 `batchSize`（默认 **8**）条
2. 逐条 GET 详情页 URL，axios `timeout` 设为 **5000ms**，请求间隔 800ms
3. 用 cheerio 提取主体内容 HTML，尝试选择器优先级：
   - `.vF_detail_main`
   - `.notice_content`
   - `#mainContent`
   - `article`
   - `body`（兜底）
   - 所有选择器匹配结果统一截取前 **200000 字符**（约 200KB），防止超出微信云数据库单文档 ~1MB 上限，且为其他字段留有余量
4. 成功时更新记录：`contentHtml = <提取并截取后的HTML>`，`detailFetchedAt = new Date()`
5. 失败时（反爬拦截含"频繁访问"/"验证码"，或请求超时/网络错误）：
   - `fetchRetryCount += 1`
   - 若 `fetchRetryCount >= 5`：将 `contentHtml` 设为字符串 `"FETCH_FAILED"`，表示放弃重试
   - 否则跳过，下次定时再试
6. 返回统计：`{ processed, succeeded, failed, abandoned }`

**超时评估（batchSize=8 默认值，axios timeout=5s）：**
- 每条最坏耗时：800ms 间隔 + 5s 请求超时 = 5.8s
- 8 条总耗时预估：7 × 800ms + 8 × 5s = 45.6s，留有约 14s 余量
- 若网络较好（每条 2s），8 条 = 7 × 800ms + 8 × 2s = 21.6s

#### 2.3 event 参数

```js
{
  batchSize: number,   // 每次处理条数，默认 8
  manual:    boolean   // true = 手动触发
}
```

#### 2.4 package.json 依赖

```json
{
  "name": "fetchDetail",
  "version": "1.0.0",
  "dependencies": {
    "wx-server-sdk": "~2.6.3",
    "axios": "^1.6.0",
    "cheerio": "1.0.0-rc.12"
  }
}
```

---

### 三、`crawl/index.js` 改造

#### 3.1 event 参数透传

`executeCrawl` 接收 event 并构造 crawlOptions 传给爬虫：

```js
exports.main = function(event, context) {
  // event.kw, event.start_time 等均为可选，未传时爬虫使用默认值
  var crawlOptions = {
    kw:         event.kw,
    start_time: event.start_time,  // YYYY-MM-DD 明文或 undefined
    end_time:   event.end_time,
    timeType:   event.timeType,
    maxPages:   event.maxPages
  };
  ...
  return crawler.crawl(crawlOptions);
};
```

#### 3.2 定时策略保留

保留现有 `checkSchedule` 逻辑，`event.manual = true` 时跳过。

---

### 四、数据库索引建议

`procurements` 集合建议添加（微信云控制台手动创建）：
- `url`：普通索引（去重查询用，微信云数据库不支持唯一索引约束）
- `contentHtml`：普通索引（fetchDetail 查询空值记录用）
- `crawledAt`：普通索引（时序排序用）

---

## 文件变更列表

| 文件 | 操作 |
|------|------|
| `cloudfunctions/crawl/crawlers/ccgp.js` | 修改：修正参数、支持 kw、动态分页、日期编码内化 |
| `cloudfunctions/crawl/config/sources.js` | 修改：更正 pinMu、bidType、displayZone |
| `cloudfunctions/crawl/index.js` | 修改：透传 event crawlOptions 给爬虫 |
| `cloudfunctions/fetchDetail/index.js` | 新建：第二阶段详情抓取 |
| `cloudfunctions/fetchDetail/package.json` | 新建 |
| `cloudfunctions/fetchDetail/config.json` | 新建 |

---

## 约束与风险

- **反爬限制**：CCGP 对高频访问有拦截，列表翻页间隔保持 500ms，详情页请求间隔保持 800ms
- **crawl 超时**：默认 maxPages=15，预估最坏耗时 52.5s（15页 × 3.5s/页），在 60s 内。超过 maxPages 的页面本次不抓，等下次定时执行自然覆盖（时间窗口滚动）
- **fetchDetail 超时**：默认 batchSize=8，axios timeout=5000ms，预估最坏耗时 45.6s（7×800ms + 8×5s），留有约 14s 余量
- **永久失败记录**：`fetchRetryCount >= 5` 后 `contentHtml` 标记为 `"FETCH_FAILED"`，不再重试，不占用后续批次配额
- **全文选择器兜底**：CCGP 详情页结构因公告类型不同可能有差异，多选择器优先级依次尝试，最终兜底为 `body` 截取
