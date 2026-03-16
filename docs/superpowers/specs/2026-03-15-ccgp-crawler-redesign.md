# CCGP 政府采购爬虫重设计

**日期：** 2026-03-15
**状态：** 待实现

---

## 背景与问题

现有 `cloudfunctions/crawl/crawlers/ccgp.js` 存在以下问题：

1. `timeType` 使用 `"6"`，应为 `"2"`（按公告时间段搜索）
2. `pinMu` 使用 `"1"`，应为 `"0"`（全部类别）
3. `bidType` 未设置，应为 `"0"`（全部类型）
4. `displayZone` 使用 `"四川省"`，应为 `"四川"`，且不支持动态传入
5. `zoneId` 硬编码在 sources.js 中，不可动态传入
6. 不支持关键字 `kw` 参数（默认应为"耗材"）
7. 翻页依赖固定 `maxPages=5`，未读取分页器实际总页数
8. 只存列表元数据，不抓取每条公告的完整原文
9. 每次爬取时间范围固定使用 -3 天，未根据存量数据自动调整

---

## 目标

- 正确抓取中国政府采购网（search.ccgp.gov.cn）指定地区指定关键字的采购公告列表
- 支持三个用户可配置的搜索条件（通过设置页 / event 参数传入）：
  - **关键字**（kw）：默认"耗材"
  - **地区**（region）：默认"四川"，动态映射为 CCGP 接口所需的 `displayZone` + `zoneId`
  - **时间范围**：自动根据存量数据智能决定
- 智能起始日期：DB 无数据时默认最近 7 天；DB 有数据时从存量数据最新 `publishDate` 开始
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
| `displayZone`  | `"四川省"` 硬编码 | 动态从 `region` 映射 | 通过 zone map 查表 |
| `zoneId`       | `"51"` 硬编码     | 动态从 `region` 映射 | 通过 zone map 查表 |
| `kw`           | 未支持     | 动态传入 | 关键字，默认"耗材" |

**地区参数（region）与 Zone Map：**

`ccgp.js` 内维护一个 `ZONE_MAP` 常量，将用户可读的省份简称映射为 CCGP 接口参数：

```js
var ZONE_MAP = {
    "北京": { displayZone: "北京", zoneId: "11" },
    "天津": { displayZone: "天津", zoneId: "12" },
    "河北": { displayZone: "河北", zoneId: "13" },
    "山西": { displayZone: "山西", zoneId: "14" },
    "内蒙古": { displayZone: "内蒙古", zoneId: "15" },
    "辽宁": { displayZone: "辽宁", zoneId: "21" },
    "吉林": { displayZone: "吉林", zoneId: "22" },
    "黑龙江": { displayZone: "黑龙江", zoneId: "23" },
    "上海": { displayZone: "上海", zoneId: "31" },
    "江苏": { displayZone: "江苏", zoneId: "32" },
    "浙江": { displayZone: "浙江", zoneId: "33" },
    "安徽": { displayZone: "安徽", zoneId: "34" },
    "福建": { displayZone: "福建", zoneId: "35" },
    "江西": { displayZone: "江西", zoneId: "36" },
    "山东": { displayZone: "山东", zoneId: "37" },
    "河南": { displayZone: "河南", zoneId: "41" },
    "湖北": { displayZone: "湖北", zoneId: "42" },
    "湖南": { displayZone: "湖南", zoneId: "43" },
    "广东": { displayZone: "广东", zoneId: "44" },
    "广西": { displayZone: "广西", zoneId: "45" },
    "海南": { displayZone: "海南", zoneId: "46" },
    "重庆": { displayZone: "重庆", zoneId: "50" },
    "四川": { displayZone: "四川", zoneId: "51" },
    "贵州": { displayZone: "贵州", zoneId: "52" },
    "云南": { displayZone: "云南", zoneId: "53" },
    "西藏": { displayZone: "西藏", zoneId: "54" },
    "陕西": { displayZone: "陕西", zoneId: "61" },
    "甘肃": { displayZone: "甘肃", zoneId: "62" },
    "青海": { displayZone: "青海", zoneId: "63" },
    "宁夏": { displayZone: "宁夏", zoneId: "64" },
    "新疆": { displayZone: "新疆", zoneId: "65" }
};
```

若 `region` 在 map 中找不到，fallback 到 `"四川"`。

**sources.js 中的 `displayZone` 和 `zoneId` 字段须移除**，由 `ccgp.js` 动态覆盖。

**日期参数格式：**
- `event` 层（外部调用）传入明文 `YYYY-MM-DD` 格式（如 `"2026-03-07"`）
- `ccgp.js` 内部在构造 HTTP 请求时将 `-` 替换为 `:` 并经 `encodeURIComponent` 编码，最终发送 `YYYY%3AMM%3ADD`
- `start_time` 的实际值由 `index.js` 的智能日期检测逻辑决定（见下方 1.6 节）

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
  region:     string,   // 省份简称，默认 "四川"；用于查 ZONE_MAP 得到 displayZone + zoneId
  start_time: string,   // YYYY-MM-DD 明文；若未传，由 index.js detectStartDate() 自动决定
  end_time:   string,   // YYYY-MM-DD 明文，默认今日
  timeType:   string,   // 默认 "2"
  maxPages:   number    // 安全翻页上限，默认 15
}
```

**`kw` 说明：** 仅支持单个关键字字符串，对应 CCGP 搜索接口的 `kw` 参数。若调用方需要多个关键字，应多次调用云函数（每次传不同 `kw`），不支持在单次调用中传入多个关键字。存入数据库的 `kw` 字段记录本次实际使用的搜索关键字。

**`region` 说明：** 用户在设置页选择省份（如"四川"），通过 event.region 传入。ccgp.js 内的 ZONE_MAP 将其转为 CCGP 接口所需的 `displayZone` 和 `zoneId`。传入不存在的省份时 fallback 到"四川"。

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

#### 1.6 智能起始日期检测（`detectStartDate`）

**位置：** 在 `crawl/index.js` 中新增 `detectStartDate(sourceId)` 函数。

**触发时机：** 每次执行爬取时，若 `event.start_time` 未显式传入，则调用此函数自动决定 `start_time`。

**逻辑：**

```
detectStartDate(sourceId):
  1. 查询 procurements 集合，where source = sourceId
     orderBy publishDate DESC，limit 1
  2. 若无记录 或 publishDate 为空字符串
       → 返回 今日 -7 天的 YYYY-MM-DD 字符串
  3. 若有记录
       → 返回 latestPublishDate（即存量数据最新公告日期）
       （不减天数，直接从最新日期当天开始，避免重复抓取太多历史数据；
        由于 CCGP 搜索是 start_time ≤ 公告日期，当天的数据也会被包含）
```

**调用位置：** 在 `crawlAllSources` 中，对每个 source 分别调用，结果合并到该 source 的 crawlOptions 中：

```js
// 若 crawlOptions.start_time 已指定，直接使用；否则自动检测
var startTimePromise = crawlOptions.start_time
    ? Promise.resolve(crawlOptions.start_time)
    : detectStartDate(source.id);

return startTimePromise.then(function(startTime) {
    var sourceOptions = Object.assign({}, crawlOptions, { start_time: startTime });
    return crawler.crawl(sourceOptions);
});
```

**说明：**
- 各来源独立检测，互不影响（CCGP 和 sichuan_ggzy 各有自己的最新日期）
- `event.start_time` 显式传入时优先使用，满足手动指定时间范围的需求
- `publishDate` 为字符串 "YYYY-MM-DD"，字典序排序可正确比较日期大小

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
  // event.kw, event.region, event.start_time 等均为可选，未传时使用默认值
  var crawlOptions = {
    kw:         event.kw,
    region:     event.region,      // 省份简称，如 "四川"
    start_time: event.start_time,  // YYYY-MM-DD 明文或 undefined（undefined时自动检测）
    end_time:   event.end_time,
    timeType:   event.timeType,
    maxPages:   event.maxPages
  };
  ...
  // start_time 的实际值由 detectStartDate 在 crawlAllSources 中动态决定
  return crawlAllSources(crawlSources, crawlResults, mergedKeywords, crawlOptions);
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
| `cloudfunctions/crawl/crawlers/ccgp.js` | 修改：修正参数、支持 kw、支持 region（ZONE_MAP）、动态分页、日期编码内化 |
| `cloudfunctions/crawl/config/sources.js` | 修改：更正 pinMu、bidType；移除 displayZone 和 zoneId（改由 ccgp.js 动态覆盖）|
| `cloudfunctions/crawl/index.js` | 修改：透传 event crawlOptions（含 region）给爬虫；新增 detectStartDate() |
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
