# CCGP 政府采购爬虫重设计 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复并增强 CCGP 爬虫，支持关键字/地区/时间三个可配置参数、动态分页、智能起始日期检测、完整原文抓取，并新增 fetchDetail 云函数补充各公告详情 HTML。

**Architecture:** 两阶段架构——`crawl` 云函数抓取列表元数据入库（第一阶段），`fetchDetail` 云函数批量补充 `contentHtml` 字段（第二阶段）。两个函数均支持定时自动触发与手动触发。

**Tech Stack:** Node.js、微信云函数（wx-server-sdk）、axios、cheerio、微信云数据库

---

## Chunk 1: crawl 云函数改造

### Task 1: 修正 sources.js 静态配置

**Files:**
- Modify: `cloudfunctions/crawl/config/sources.js`

- [ ] **Step 1: 更新 sources.js 中 ccgp 来源的固定参数**

打开 `cloudfunctions/crawl/config/sources.js`，将 ccgp 来源的 `params` 对象替换为以下内容。
**注意：移除 `displayZone` 和 `zoneId`**——这两个字段将由 `ccgp.js` 根据 `region` 参数动态覆盖，不再硬编码在此处：

```js
params: {
    searchtype: "1",
    bidSort: "0",
    pinMu: "0",
    bidType: "0",
    dbselect: "bidx",
    pppStatus: "0"
},
```

- [ ] **Step 2: 验证文件语法正确，且确认无 displayZone/zoneId 字段**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl
node -e "var s = require('./config/sources'); var p = s.getSourceById('ccgp').params; console.log(JSON.stringify(p, null, 2)); console.assert(!p.displayZone, 'FAIL: displayZone should not be in params'); console.assert(!p.zoneId, 'FAIL: zoneId should not be in params'); console.log('PASS: displayZone and zoneId correctly removed');"
```

预期输出：
```json
{
  "searchtype": "1",
  "bidSort": "0",
  "pinMu": "0",
  "bidType": "0",
  "dbselect": "bidx",
  "pppStatus": "0"
}
```
```
PASS: displayZone and zoneId correctly removed
```

---

### Task 2: 重写 ccgp.js 核心爬虫

**Files:**
- Modify: `cloudfunctions/crawl/crawlers/ccgp.js`

#### Step 2a: Zone Map 和地区映射测试

- [ ] **Step 1: 写测试脚本验证 ZONE_MAP 查表和日期格式转换逻辑**

创建临时测试文件 `cloudfunctions/crawl/test_ccgp_zone_date.js`：

```js
// ZONE_MAP：省份简称 → {displayZone, zoneId}
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

function getZoneInfo(region) {
    return ZONE_MAP[region] || ZONE_MAP["四川"];
}

function formatCcgpDate(dateStr) {
    return dateStr.replace(/-/g, "%3A");
}

function getDefaultDateStr(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}

// 测试1：四川 → zoneId=51
var z1 = getZoneInfo("四川");
console.assert(z1.zoneId === "51", "FAIL: 四川 zoneId wrong: " + z1.zoneId);
console.assert(z1.displayZone === "四川", "FAIL: 四川 displayZone wrong: " + z1.displayZone);
console.log("zoneMap 四川:", z1.zoneId === "51" && z1.displayZone === "四川" ? "PASS" : "FAIL");

// 测试2：广东 → zoneId=44
var z2 = getZoneInfo("广东");
console.assert(z2.zoneId === "44", "FAIL: 广东 zoneId wrong: " + z2.zoneId);
console.log("zoneMap 广东:", z2.zoneId === "44" ? "PASS" : "FAIL");

// 测试3：未知省份 → fallback 到四川
var z3 = getZoneInfo("不存在省");
console.assert(z3.zoneId === "51", "FAIL: fallback should be 四川 (51), got " + z3.zoneId);
console.log("zoneMap fallback:", z3.zoneId === "51" ? "PASS" : "FAIL");

// 测试4：formatCcgpDate
var r4 = formatCcgpDate("2026-03-07");
console.assert(r4 === "2026%3A03%3A07", "FAIL: expected 2026%3A03%3A07, got " + r4);
console.log("formatCcgpDate:", r4 === "2026%3A03%3A07" ? "PASS" : "FAIL");

// 测试5：getDefaultDateStr 格式
var today = getDefaultDateStr(0);
console.assert(/^\d{4}-\d{2}-\d{2}$/.test(today), "FAIL: date format wrong: " + today);
console.log("getDefaultDateStr format:", /^\d{4}-\d{2}-\d{2}$/.test(today) ? "PASS" : "FAIL");
```

- [ ] **Step 2: 运行测试，确认全部 PASS**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl
node test_ccgp_zone_date.js
```

预期输出（5行全部 PASS）：
```
zoneMap 四川: PASS
zoneMap 广东: PASS
zoneMap fallback: PASS
formatCcgpDate: PASS
getDefaultDateStr format: PASS
```

#### Step 2b: 动态分页解析

- [ ] **Step 3: 写测试脚本验证 parseTotalPages 逻辑**

创建 `cloudfunctions/crawl/test_ccgp_pager.js`：

```js
var cheerio = require("cheerio");

function parseTotalPages($) {
    var text = $(".pager").text();
    var match = text.match(/共\s*(\d+)\s*页/);
    if (match) return parseInt(match[1]);
    var max = 1;
    $(".pager a").each(function() {
        var n = parseInt($(this).text().trim());
        if (!isNaN(n) && n > max) max = n;
    });
    return max;
}

// 测试1：包含"共 X 页"文字
var html1 = '<p class="pager">共 5 页 <a>1</a><a>2</a><a>3</a></p>';
var $1 = cheerio.load(html1);
var r1 = parseTotalPages($1);
console.assert(r1 === 5, "FAIL test1: expected 5, got " + r1);
console.log("parseTotalPages with text:", r1 === 5 ? "PASS" : "FAIL");

// 测试2：无文字，靠链接数字最大值（忽略非数字链接如"下一页"）
var html2 = '<p class="pager"><a>1</a><a>2</a><a>3</a><a>下一页</a></p>';
var $2 = cheerio.load(html2);
var r2 = parseTotalPages($2);
console.assert(r2 === 3, "FAIL test2: expected 3, got " + r2);
console.log("parseTotalPages by links:", r2 === 3 ? "PASS" : "FAIL");

// 测试3：无分页器（单页结果）
var html3 = '<div class="content">no pager</div>';
var $3 = cheerio.load(html3);
var r3 = parseTotalPages($3);
console.assert(r3 === 1, "FAIL test3: expected 1, got " + r3);
console.log("parseTotalPages no pager:", r3 === 1 ? "PASS" : "FAIL");
```

- [ ] **Step 4: 运行测试，确认全部 PASS**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl
node test_ccgp_pager.js
```

预期输出：
```
parseTotalPages with text: PASS
parseTotalPages by links: PASS
parseTotalPages no pager: PASS
```

#### Step 2c: 列表解析函数测试

- [ ] **Step 5: 写测试脚本验证 parseCcgpList 解析结构**

创建 `cloudfunctions/crawl/test_ccgp_parse.js`：

```js
var cheerio = require("cheerio");

function cleanText(text) {
    if (!text) return "";
    return text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseMetaText(text) {
    var info = { date: "", buyer: "", agent: "", bidType: "", region: "" };
    if (!text) return info;
    var dateMatch = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (dateMatch) {
        var month = dateMatch[2].length === 1 ? "0" + dateMatch[2] : dateMatch[2];
        var day = dateMatch[3].length === 1 ? "0" + dateMatch[3] : dateMatch[3];
        info.date = dateMatch[1] + "-" + month + "-" + day;
    }
    var parts = text.split("|");
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (part.indexOf("采购人") !== -1) {
            info.buyer = part.replace(/采购人[：:]\s*/, "").trim();
        } else if (part.indexOf("代理机构") !== -1) {
            info.agent = part.replace(/代理机构[：:]\s*/, "").trim();
        }
    }
    if (text.indexOf("四川") !== -1) info.region = "四川省";
    return info;
}

function parseCcgpList($, config, kw) {
    var items = [];
    $(".vT-srch-result-list-bid li").each(function() {
        var $li = $(this);
        var $a = $li.find("a").first();
        var title = $a.text().replace(/<[^>]+>/g, "").trim();
        var url = $a.attr("href") || "";
        if (!title || !url) return;
        if (url.indexOf("http") !== 0) url = "http://www.ccgp.gov.cn" + url;
        var spans = $li.find("span");
        var metaText = "";
        spans.each(function() { metaText += $(this).text() + " | "; });
        var info = parseMetaText(metaText);
        items.push({
            title: cleanText(title),
            url: url,
            source: config.id,
            sourceName: config.name,
            publishDate: info.date || "",
            region: info.region || "四川省",
            buyer: info.buyer || "",
            agent: info.agent || "",
            bidType: info.bidType || "",
            kw: kw,
            contentHtml: null,
            fetchRetryCount: 0,
            detailFetchedAt: null,
            crawledAt: new Date()
        });
    });
    return items;
}

// 测试：标准列表 HTML
var html = [
    '<ul class="vT-srch-result-list-bid">',
    '  <li>',
    '    <a href="/cggg/szfcg/cgsgg/202603/t20260307_12345.htm">四川大学耗材采购公告</a>',
    '    <span>2026-03-07</span>',
    '    <span>采购人：四川大学</span>',
    '    <span>代理机构：测试代理有限公司</span>',
    '  </li>',
    '</ul>'
].join("\n");

var config = { id: "ccgp", name: "中国政府采购网" };
// 传入 regionLabel（来自 ZONE_MAP["四川"].displayZone）
var items = parseCcgpList(cheerio.load(html), config, "耗材", "四川");

console.assert(items.length === 1, "FAIL: expected 1 item, got " + items.length);
console.assert(items[0].title === "四川大学耗材采购公告", "FAIL: title wrong: " + items[0].title);
console.assert(items[0].url.indexOf("http") === 0, "FAIL: url not absolute: " + items[0].url);
console.assert(items[0].kw === "耗材", "FAIL: kw wrong: " + items[0].kw);
console.assert(items[0].region === "四川", "FAIL: region should be '四川', got " + items[0].region);
console.assert(items[0].contentHtml === null, "FAIL: contentHtml should be null");
console.assert(items[0].fetchRetryCount === 0, "FAIL: fetchRetryCount should be 0");
console.assert(items[0].buyer === "四川大学", "FAIL: buyer wrong: " + items[0].buyer);
console.assert(items[0].crawledAt instanceof Date, "FAIL: crawledAt should be Date instance");

// 测试非默认省份 regionLabel 正确入库
var items2 = parseCcgpList(cheerio.load(html), config, "耗材", "广东");
console.assert(items2[0].region === "广东", "FAIL: region should be '广东', got " + items2[0].region);

console.log("parseCcgpList item count:", items.length === 1 ? "PASS" : "FAIL");
console.log("parseCcgpList title:", items[0].title === "四川大学耗材采购公告" ? "PASS" : "FAIL");
console.log("parseCcgpList url absolute:", items[0].url.indexOf("http") === 0 ? "PASS" : "FAIL");
console.log("parseCcgpList kw field:", items[0].kw === "耗材" ? "PASS" : "FAIL");
console.log("parseCcgpList region from label:", items[0].region === "四川" ? "PASS" : "FAIL");
console.log("parseCcgpList region non-default:", items2[0].region === "广东" ? "PASS" : "FAIL");
console.log("parseCcgpList contentHtml null:", items[0].contentHtml === null ? "PASS" : "FAIL");
console.log("parseCcgpList fetchRetryCount 0:", items[0].fetchRetryCount === 0 ? "PASS" : "FAIL");
console.log("parseCcgpList crawledAt is Date:", items[0].crawledAt instanceof Date ? "PASS" : "FAIL");
```

- [ ] **Step 6: 运行测试，确认全部 PASS**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl
node test_ccgp_parse.js
```

预期输出（9行全部 PASS）：
```
parseCcgpList item count: PASS
parseCcgpList title: PASS
parseCcgpList url absolute: PASS
parseCcgpList kw field: PASS
parseCcgpList region from label: PASS
parseCcgpList region non-default: PASS
parseCcgpList contentHtml null: PASS
parseCcgpList fetchRetryCount 0: PASS
parseCcgpList crawledAt is Date: PASS
```

#### Step 2d: 重写 ccgp.js

- [ ] **Step 7: 用以下完整内容替换 `cloudfunctions/crawl/crawlers/ccgp.js`**

此为最终完整版本，包含 ZONE_MAP、region 参数处理、regionLabel 传入 parseCcgpList：

```js
var cheerio = require("cheerio");
var baseModule = require("./base");
var BaseCrawler = baseModule.BaseCrawler;
var sleep = baseModule.sleep;

// 省份简称 → CCGP 接口参数映射
var ZONE_MAP = {
	"北京":   { displayZone: "北京",   zoneId: "11" },
	"天津":   { displayZone: "天津",   zoneId: "12" },
	"河北":   { displayZone: "河北",   zoneId: "13" },
	"山西":   { displayZone: "山西",   zoneId: "14" },
	"内蒙古": { displayZone: "内蒙古", zoneId: "15" },
	"辽宁":   { displayZone: "辽宁",   zoneId: "21" },
	"吉林":   { displayZone: "吉林",   zoneId: "22" },
	"黑龙江": { displayZone: "黑龙江", zoneId: "23" },
	"上海":   { displayZone: "上海",   zoneId: "31" },
	"江苏":   { displayZone: "江苏",   zoneId: "32" },
	"浙江":   { displayZone: "浙江",   zoneId: "33" },
	"安徽":   { displayZone: "安徽",   zoneId: "34" },
	"福建":   { displayZone: "福建",   zoneId: "35" },
	"江西":   { displayZone: "江西",   zoneId: "36" },
	"山东":   { displayZone: "山东",   zoneId: "37" },
	"河南":   { displayZone: "河南",   zoneId: "41" },
	"湖北":   { displayZone: "湖北",   zoneId: "42" },
	"湖南":   { displayZone: "湖南",   zoneId: "43" },
	"广东":   { displayZone: "广东",   zoneId: "44" },
	"广西":   { displayZone: "广西",   zoneId: "45" },
	"海南":   { displayZone: "海南",   zoneId: "46" },
	"重庆":   { displayZone: "重庆",   zoneId: "50" },
	"四川":   { displayZone: "四川",   zoneId: "51" },
	"贵州":   { displayZone: "贵州",   zoneId: "52" },
	"云南":   { displayZone: "云南",   zoneId: "53" },
	"西藏":   { displayZone: "西藏",   zoneId: "54" },
	"陕西":   { displayZone: "陕西",   zoneId: "61" },
	"甘肃":   { displayZone: "甘肃",   zoneId: "62" },
	"青海":   { displayZone: "青海",   zoneId: "63" },
	"宁夏":   { displayZone: "宁夏",   zoneId: "64" },
	"新疆":   { displayZone: "新疆",   zoneId: "65" }
};

function CcgpCrawler(config) {
	BaseCrawler.call(this, config);
}

CcgpCrawler.prototype = Object.create(BaseCrawler.prototype);
CcgpCrawler.prototype.constructor = CcgpCrawler;

CcgpCrawler.prototype.crawl = function(options) {
	var self = this;
	var opts = options || {};
	var kw = opts.kw !== undefined ? opts.kw : "耗材";
	var region = opts.region || "四川";
	var zoneInfo = ZONE_MAP[region] || ZONE_MAP["四川"];
	var dateFrom = opts.start_time ? formatCcgpDate(opts.start_time) : formatCcgpDate(getDefaultDateStr(-7));
	var dateTo = opts.end_time ? formatCcgpDate(opts.end_time) : formatCcgpDate(getDefaultDateStr(0));
	var timeType = opts.timeType || "2";
	var maxPages = opts.maxPages || 15;

	var allItems = [];
	var partialErrors = [];
	var seenUrls = {};

	return crawlPages(self, kw, zoneInfo, dateFrom, dateTo, timeType, maxPages, seenUrls, partialErrors)
		.then(function(items) {
			for (var i = 0; i < items.length; i++) {
				allItems.push(items[i]);
			}
			return { items: allItems, partialErrors: partialErrors };
		});
};

function crawlPages(crawler, kw, zoneInfo, dateFrom, dateTo, timeType, maxPages, seenUrls, partialErrors) {
	var items = [];
	var resolvedMaxPages = null;

	function crawlPage(page) {
		var params = Object.assign({}, crawler.config.params, {
			kw: kw,
			start_time: dateFrom,
			end_time: dateTo,
			timeType: timeType,
			page_index: String(page),
			displayZone: zoneInfo.displayZone,
			zoneId: zoneInfo.zoneId
		});

		console.log("[CCGP] 正在抓取第" + page + "页");

		return crawler.fetch(crawler.config.baseUrl, {
			params: params,
			headers: {
				"Referer": "http://search.ccgp.gov.cn/"
			}
		}).then(function(response) {
			var html = response.data;

			if (html.indexOf("频繁访问") !== -1 || html.indexOf("验证码") !== -1) {
				var msg = "CCGP反爬拦截：云函数IP被限制访问，请稍后重试";
				console.error("[CCGP] " + msg);
				partialErrors.push(msg);
				return items;
			}

			var $ = cheerio.load(html);

			// 第一页时解析总页数，确定实际抓取上限
			if (page === 1) {
				var totalPages = parseTotalPages($);
				resolvedMaxPages = Math.min(totalPages, maxPages);
				console.log("[CCGP] 总页数=" + totalPages + "，实际抓取上限=" + resolvedMaxPages);
			}

			// 将 zoneInfo.displayZone 作为 regionLabel 直接入库，不依赖 HTML 解析
			var pageItems = parseCcgpList($, crawler.config, kw, zoneInfo.displayZone);

			if (pageItems.length === 0) {
				console.log("[CCGP] 第" + page + "页无数据，停止翻页");
				return items;
			}

			for (var i = 0; i < pageItems.length; i++) {
				var item = pageItems[i];
				if (!seenUrls[item.url]) {
					seenUrls[item.url] = true;
					items.push(item);
				}
			}

			console.log("[CCGP] 第" + page + "页获取 " + pageItems.length + " 条");

			if (page < resolvedMaxPages) {
				return sleep(500).then(function() {
					return crawlPage(page + 1);
				});
			}
			return items;
		}).catch(function(err) {
			var msg = "第" + page + "页失败: " + err.message;
			console.error("[CCGP] " + msg);
			partialErrors.push(msg);
			return items;
		});
	}

	return crawlPage(1);
}

function parseTotalPages($) {
	var text = $(".pager").text();
	var match = text.match(/共\s*(\d+)\s*页/);
	if (match) return parseInt(match[1]);
	var max = 1;
	$(".pager a").each(function() {
		var n = parseInt($(this).text().trim());
		if (!isNaN(n) && n > max) max = n;
	});
	return max;
}

// regionLabel：由调用方传入（zoneInfo.displayZone），直接作为 region 字段入库
// 不依赖 HTML parseMetaText 的 region 解析，确保多省份场景下数据正确
function parseCcgpList($, config, kw, regionLabel) {
	var items = [];

	$(".vT-srch-result-list-bid li").each(function() {
		var $li = $(this);
		var $a = $li.find("a").first();
		var title = $a.text().replace(/<[^>]+>/g, "").trim();
		var url = $a.attr("href") || "";

		if (!title || !url) {
			return;
		}

		if (url.indexOf("http") !== 0) {
			url = "http://www.ccgp.gov.cn" + url;
		}

		var spans = $li.find("span");
		var metaText = "";
		spans.each(function() {
			metaText += $(this).text() + " | ";
		});

		var info = parseMetaText(metaText);

		items.push({
			title: cleanText(title),
			url: url,
			source: config.id,
			sourceName: config.name,
			publishDate: info.date || "",
			region: regionLabel || "四川",
			buyer: info.buyer || "",
			agent: info.agent || "",
			bidType: info.bidType || "",
			kw: kw,
			contentHtml: null,
			fetchRetryCount: 0,
			detailFetchedAt: null,
			crawledAt: new Date()
		});
	});

	return items;
}

function parseMetaText(text) {
	var info = {
		date: "",
		buyer: "",
		agent: "",
		bidType: ""
	};

	if (!text) {
		return info;
	}

	var dateMatch = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
	if (dateMatch) {
		var month = dateMatch[2].length === 1 ? "0" + dateMatch[2] : dateMatch[2];
		var day = dateMatch[3].length === 1 ? "0" + dateMatch[3] : dateMatch[3];
		info.date = dateMatch[1] + "-" + month + "-" + day;
	}

	var parts = text.split("|");
	for (var i = 0; i < parts.length; i++) {
		var part = parts[i].trim();
		if (part.indexOf("采购人") !== -1) {
			info.buyer = part.replace(/采购人[：:]\s*/, "").trim();
		} else if (part.indexOf("代理机构") !== -1) {
			info.agent = part.replace(/代理机构[：:]\s*/, "").trim();
		} else if (part.indexOf("公告") !== -1 || part.indexOf("招标") !== -1 || part.indexOf("磋商") !== -1 || part.indexOf("询价") !== -1 || part.indexOf("谈判") !== -1) {
			if (part.length <= 10) {
				info.bidType = part;
			}
		}
	}

	return info;
}

function cleanText(text) {
	if (!text) {
		return "";
	}
	return text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// 将 YYYY-MM-DD 转为 CCGP 接口要求的 YYYY%3AMM%3ADD
function formatCcgpDate(dateStr) {
	return dateStr.replace(/-/g, "%3A");
}

// 生成相对今日 offsetDays 天的 YYYY-MM-DD 字符串
function getDefaultDateStr(offsetDays) {
	var d = new Date();
	d.setDate(d.getDate() + offsetDays);
	var y = d.getFullYear();
	var m = d.getMonth() + 1;
	var day = d.getDate();
	return y + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}

module.exports = CcgpCrawler;
```

- [ ] **Step 8: 用现有测试脚本回归验证**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl
node test_ccgp_zone_date.js && node test_ccgp_pager.js && node test_ccgp_parse.js
```

预期：所有测试行均显示 PASS。

- [ ] **Step 9: 验证 ccgp.js 语法正确**

```bash
node --check /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl/crawlers/ccgp.js && echo "syntax OK"
```

预期：`syntax OK`

- [ ] **Step 10: 清理临时测试文件**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl
rm test_ccgp_zone_date.js test_ccgp_pager.js test_ccgp_parse.js
```

---

### Task 3: 修改 crawl/index.js 透传 event 参数

**Files:**
- Modify: `cloudfunctions/crawl/index.js`

- [ ] **Step 1: 修改 `exports.main`，提取 crawlOptions（含 region）并传给 executeCrawl**

打开 `cloudfunctions/crawl/index.js`，将 `exports.main` 函数（当前第21-36行）替换为：

```js
exports.main = function(event, context) {
	var isManual = event.manual || false;
	console.log("[Crawl] 开始执行, 手动触发=" + isManual);

	var crawlOptions = {
		kw:         event.kw,
		region:     event.region,      // 省份简称，如 "四川"；未传时爬虫默认"四川"
		start_time: event.start_time,  // YYYY-MM-DD 明文；未传时由 detectStartDate 自动决定
		end_time:   event.end_time,
		timeType:   event.timeType,
		maxPages:   event.maxPages
	};

	if (!isManual) {
		return checkSchedule().then(function(shouldRun) {
			if (!shouldRun) {
				console.log("[Crawl] 当前不满足抓取策略条件，跳过执行");
				return { code: 0, message: "跳过执行（不满足策略条件）", data: null };
			}
			return executeCrawl(crawlOptions);
		});
	}

	return executeCrawl(crawlOptions);
};
```

- [ ] **Step 2: 修改 `executeCrawl` 函数签名接收 crawlOptions**

原始签名为 `function executeCrawl() {`，将其改为：

```js
function executeCrawl(crawlOptions) {
```

- [ ] **Step 3: 修改 `crawlAllSources` 调用，透传 crawlOptions**

在 `executeCrawl` 内找到以下调用：
```js
return crawlAllSources(crawlSources, crawlResults, mergedKeywords);
```
改为：
```js
return crawlAllSources(crawlSources, crawlResults, mergedKeywords, crawlOptions);
```

- [ ] **Step 4: 修改 `crawlAllSources` 函数签名和内部 crawl 调用，加入 detectStartDate 逻辑**

原始签名为：
```js
function crawlAllSources(sources, results, mergedKeywords) {
```
改为：
```js
function crawlAllSources(sources, results, mergedKeywords, crawlOptions) {
```

在该函数内，找到 `crawler.crawl({})` 调用（在 `crawlNext` 内部），将其替换为含智能日期检测的版本：

```js
// 若 crawlOptions.start_time 已显式指定，直接使用
// 否则调用 detectStartDate 自动决定（从存量数据最新 publishDate 开始，或 7 天前）
var startTimePromise = (crawlOptions && crawlOptions.start_time)
    ? Promise.resolve(crawlOptions.start_time)
    : detectStartDate(source.id);

return startTimePromise.then(function(resolvedStartTime) {
    var sourceOptions = Object.assign({}, crawlOptions || {}, { start_time: resolvedStartTime });
    console.log("[Crawl] " + source.name + " 使用 start_time=" + resolvedStartTime);
    return crawler.crawl(sourceOptions);
})
```

- [ ] **Step 5: 在 index.js 末尾（`saveCrawlLog` 函数之后）新增 `detectStartDate` 函数**

```js
/**
 * 检测指定来源的最新公告日期，用于确定本次爬取的 start_time。
 * - 若 DB 中无该来源的记录：返回今日 -7 天（首次运行默认覆盖最近一周）
 * - 若 DB 有记录：返回最新记录的 publishDate（避免重复抓取大量历史数据）
 */
function detectStartDate(sourceId) {
    return db.collection("procurements")
        .where({ source: sourceId })
        .orderBy("publishDate", "desc")
        .limit(1)
        .get()
        .then(function(res) {
            if (res.data.length === 0 || !res.data[0].publishDate) {
                var defaultStart = getDefaultCrawlDate(-7);
                console.log("[Crawl] detectStartDate(" + sourceId + "): 无存量数据，使用默认 " + defaultStart);
                return defaultStart;
            }
            var latestDate = res.data[0].publishDate;
            console.log("[Crawl] detectStartDate(" + sourceId + "): 存量最新日期=" + latestDate);
            return latestDate;
        })
        .catch(function(err) {
            console.warn("[Crawl] detectStartDate 查询失败，使用默认: " + err.message);
            return getDefaultCrawlDate(-7);
        });
}

function getDefaultCrawlDate(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}
```

- [ ] **Step 6: 验证 index.js 语法正确**

```bash
node --check /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl/index.js && echo "syntax OK"
```

预期：`syntax OK`

- [ ] **Step 7: Commit 第一阶段改造**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler
git add cloudfunctions/crawl/config/sources.js
git add cloudfunctions/crawl/crawlers/ccgp.js
git add cloudfunctions/crawl/index.js
git commit -m "feat: 修正 CCGP 爬虫参数，支持 kw/region 参数、动态分页、智能起始日期检测"
```

---

## Chunk 2: fetchDetail 云函数（新建）

### Task 4: 新建 fetchDetail 云函数配置文件

**Files:**
- Create: `cloudfunctions/fetchDetail/config.json`
- Create: `cloudfunctions/fetchDetail/package.json`

- [ ] **Step 1: 创建 config.json**

保存到 `cloudfunctions/fetchDetail/config.json`：

```json
{
  "permissions": {
    "openapi": []
  }
}
```

- [ ] **Step 2: 创建 package.json**

保存到 `cloudfunctions/fetchDetail/package.json`：

```json
{
  "name": "fetchDetail",
  "version": "1.0.0",
  "description": "采购公告详情抓取云函数",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3",
    "axios": "^1.6.0",
    "cheerio": "1.0.0-rc.12"
  }
}
```

注意：微信云函数超时需在微信开发者工具的云函数配置界面设置（本项目对应 `fetchDetail` 应设为 60000ms），`package.json` 中无法配置超时。

---

### Task 5: 实现 fetchDetail 核心逻辑

**Files:**
- Create: `cloudfunctions/fetchDetail/index.js`

#### Step 5a: 测试 HTML 提取和重试逻辑

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/fetchDetail
npm install
```

预期：安装完成无报错。

- [ ] **Step 2: 写测试脚本验证内容提取与重试计数决策逻辑**

创建临时文件 `cloudfunctions/fetchDetail/test_extract.js`：

```js
var cheerio = require("cheerio");

var MAX_CONTENT_LENGTH = 200000;
var MAX_RETRY_COUNT = 5;

var SELECTORS = [
    ".vF_detail_main",
    ".notice_content",
    "#mainContent",
    "article",
    "body"
];

function extractContentHtml(html) {
    var $ = cheerio.load(html);
    for (var i = 0; i < SELECTORS.length; i++) {
        var el = $(SELECTORS[i]);
        if (el.length > 0) {
            var content = el.html() || "";
            if (content.trim()) {
                return content.substring(0, MAX_CONTENT_LENGTH);
            }
        }
    }
    return "";
}

function isBlocked(html) {
    return html.indexOf("频繁访问") !== -1 || html.indexOf("验证码") !== -1;
}

// 重试计数决策：纯函数，无 DB 依赖
function decideRetryAction(currentRetryCount) {
    var newCount = currentRetryCount + 1;
    if (newCount >= MAX_RETRY_COUNT) {
        return { action: "abandon", newCount: newCount };
    }
    return { action: "retry", newCount: newCount };
}

// === 内容提取测试 ===

// 测试1：命中第一优先级选择器
var html1 = '<div class="vF_detail_main"><h1>公告标题</h1><p>公告内容</p></div>';
var r1 = extractContentHtml(html1);
console.assert(r1.indexOf("公告内容") !== -1, "FAIL test1: content not found");
console.log("extract vF_detail_main:", r1.indexOf("公告内容") !== -1 ? "PASS" : "FAIL");

// 测试2：降级到 notice_content
var html2 = '<div class="notice_content"><p>通知内容</p></div>';
var r2 = extractContentHtml(html2);
console.assert(r2.indexOf("通知内容") !== -1, "FAIL test2: content not found");
console.log("extract notice_content fallback:", r2.indexOf("通知内容") !== -1 ? "PASS" : "FAIL");

// 测试3：兜底到 body
var html3 = '<html><body><p>正文</p></body></html>';
var r3 = extractContentHtml(html3);
console.assert(r3.indexOf("正文") !== -1, "FAIL test3: body fallback failed");
console.log("extract body fallback:", r3.indexOf("正文") !== -1 ? "PASS" : "FAIL");

// 测试4：截取上限 200000 字符
var longHtml = '<div class="vF_detail_main">' + "A".repeat(250000) + '</div>';
var r4 = extractContentHtml(longHtml);
console.assert(r4.length === MAX_CONTENT_LENGTH, "FAIL test4: expected " + MAX_CONTENT_LENGTH + ", got " + r4.length);
console.log("extract truncation:", r4.length === MAX_CONTENT_LENGTH ? "PASS" : "FAIL");

// 测试5：反爬检测
console.assert(isBlocked("请完成验证码验证") === true, "FAIL test5a");
console.assert(isBlocked("频繁访问被限制") === true, "FAIL test5b");
console.assert(isBlocked("正常公告内容") === false, "FAIL test5c");
console.log("isBlocked detection:", "PASS");

// === 重试计数决策测试 ===

// 测试6：currentRetryCount=0，失败后应继续重试（newCount=1 < 5）
var d6 = decideRetryAction(0);
console.assert(d6.action === "retry", "FAIL test6: expected retry, got " + d6.action);
console.assert(d6.newCount === 1, "FAIL test6: expected newCount=1, got " + d6.newCount);
console.log("retry decision count=0:", d6.action === "retry" && d6.newCount === 1 ? "PASS" : "FAIL");

// 测试7：currentRetryCount=3，失败后应继续重试（newCount=4 < 5）
var d7 = decideRetryAction(3);
console.assert(d7.action === "retry", "FAIL test7: expected retry, got " + d7.action);
console.assert(d7.newCount === 4, "FAIL test7: expected newCount=4, got " + d7.newCount);
console.log("retry decision count=3:", d7.action === "retry" && d7.newCount === 4 ? "PASS" : "FAIL");

// 测试8：currentRetryCount=4，失败后应放弃（newCount=5 >= 5）
var d8 = decideRetryAction(4);
console.assert(d8.action === "abandon", "FAIL test8: expected abandon, got " + d8.action);
console.assert(d8.newCount === 5, "FAIL test8: expected newCount=5, got " + d8.newCount);
console.log("abandon decision count=4:", d8.action === "abandon" && d8.newCount === 5 ? "PASS" : "FAIL");

// 测试9：currentRetryCount=5（已被放弃状态，不应被查询到，防御性测试）
var d9 = decideRetryAction(5);
console.assert(d9.action === "abandon", "FAIL test9: expected abandon, got " + d9.action);
console.log("abandon decision count=5:", d9.action === "abandon" ? "PASS" : "FAIL");
```

- [ ] **Step 3: 运行测试，确认全部 PASS**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/fetchDetail
node test_extract.js
```

预期输出（9行全部 PASS）：
```
extract vF_detail_main: PASS
extract notice_content fallback: PASS
extract body fallback: PASS
extract truncation: PASS
isBlocked detection: PASS
retry decision count=0: PASS
retry decision count=3: PASS
abandon decision count=4: PASS
abandon decision count=5: PASS
```

#### Step 5b: 实现 fetchDetail/index.js

- [ ] **Step 4: 创建完整的 `cloudfunctions/fetchDetail/index.js`**

```js
var cloud = require("wx-server-sdk");
var axios = require("axios");
var cheerio = require("cheerio");

cloud.init({
	env: cloud.DYNAMIC_CURRENT_ENV
});

var db = cloud.database();
var _ = db.command;

var MAX_CONTENT_LENGTH = 200000;
var MAX_RETRY_COUNT = 5;

var CONTENT_SELECTORS = [
	".vF_detail_main",
	".notice_content",
	"#mainContent",
	"article",
	"body"
];

var DEFAULT_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "zh-CN,zh;q=0.9",
	"Connection": "keep-alive"
};

exports.main = function(event, context) {
	var batchSize = event.batchSize || 8;
	console.log("[FetchDetail] 开始执行, batchSize=" + batchSize);

	return fetchPendingItems(batchSize)
		.then(function(items) {
			if (items.length === 0) {
				console.log("[FetchDetail] 无待处理记录");
				return { code: 0, message: "无待处理记录", data: { processed: 0, succeeded: 0, failed: 0, abandoned: 0 } };
			}
			console.log("[FetchDetail] 本批处理 " + items.length + " 条");
			return processItems(items);
		})
		.then(function(stats) {
			console.log("[FetchDetail] 完成: " + JSON.stringify(stats));
			return { code: 0, message: "完成", data: stats };
		})
		.catch(function(err) {
			console.error("[FetchDetail] 执行失败: " + err.message);
			return { code: -1, message: "执行失败: " + err.message, data: null };
		});
};

// 查询待处理记录：contentHtml 为 null 且 fetchRetryCount < MAX_RETRY_COUNT
// 注意：微信云数据库跨字段 AND 直接用对象形式，不用 _.and([...])
function fetchPendingItems(batchSize) {
	return db.collection("procurements")
		.where({
			contentHtml: null,
			fetchRetryCount: _.lt(MAX_RETRY_COUNT)
		})
		.orderBy("crawledAt", "asc")
		.limit(batchSize)
		.get()
		.then(function(res) {
			return res.data;
		});
}

function processItems(items) {
	var stats = { processed: 0, succeeded: 0, failed: 0, abandoned: 0 };

	function processNext(index) {
		if (index >= items.length) {
			return Promise.resolve(stats);
		}

		var item = items[index];
		stats.processed++;

		return fetchItemDetail(item)
			.then(function(result) {
				if (result.success) {
					stats.succeeded++;
					return updateItemSuccess(item._id, result.contentHtml);
				} else {
					var newRetryCount = (item.fetchRetryCount || 0) + 1;
					if (newRetryCount >= MAX_RETRY_COUNT) {
						stats.abandoned++;
						console.log("[FetchDetail] 放弃: " + item.url + " (已重试" + newRetryCount + "次)");
						return updateItemAbandoned(item._id, newRetryCount);
					} else {
						stats.failed++;
						console.log("[FetchDetail] 失败，下次重试: " + item.url + " (" + result.reason + ")");
						return updateItemRetryCount(item._id, newRetryCount);
					}
				}
			})
			.then(function() {
				// 除最后一条外，请求之间等待 800ms 避免反爬
				if (index < items.length - 1) {
					return sleep(800).then(function() {
						return processNext(index + 1);
					});
				}
				return processNext(index + 1);
			});
	}

	return processNext(0);
}

function fetchItemDetail(item) {
	return axios({
		url: item.url,
		method: "GET",
		headers: Object.assign({}, DEFAULT_HEADERS, {
			"Referer": "http://www.ccgp.gov.cn/"
		}),
		timeout: 5000,
		responseType: "text",
		maxRedirects: 5
	}).then(function(response) {
		var html = response.data;

		if (html.indexOf("频繁访问") !== -1 || html.indexOf("验证码") !== -1) {
			return { success: false, reason: "反爬拦截" };
		}

		var contentHtml = extractContentHtml(html);
		if (!contentHtml) {
			return { success: false, reason: "无法提取内容" };
		}

		return { success: true, contentHtml: contentHtml };
	}).catch(function(err) {
		return { success: false, reason: err.message };
	});
}

function extractContentHtml(html) {
	var $ = cheerio.load(html);
	for (var i = 0; i < CONTENT_SELECTORS.length; i++) {
		var el = $(CONTENT_SELECTORS[i]);
		if (el.length > 0) {
			var content = el.html() || "";
			if (content.trim()) {
				return content.substring(0, MAX_CONTENT_LENGTH);
			}
		}
	}
	return "";
}

function updateItemSuccess(id, contentHtml) {
	return db.collection("procurements")
		.doc(id)
		.update({
			data: {
				contentHtml: contentHtml,
				detailFetchedAt: new Date()
			}
		})
		.catch(function(err) {
			console.error("[FetchDetail] 更新成功记录失败: " + err.message);
		});
}

function updateItemAbandoned(id, retryCount) {
	return db.collection("procurements")
		.doc(id)
		.update({
			data: {
				contentHtml: "FETCH_FAILED",
				fetchRetryCount: retryCount
			}
		})
		.catch(function(err) {
			console.error("[FetchDetail] 更新放弃记录失败: " + err.message);
		});
}

function updateItemRetryCount(id, retryCount) {
	return db.collection("procurements")
		.doc(id)
		.update({
			data: {
				fetchRetryCount: retryCount
			}
		})
		.catch(function(err) {
			console.error("[FetchDetail] 更新重试次数失败: " + err.message);
		});
}

function sleep(ms) {
	return new Promise(function(resolve) {
		setTimeout(resolve, ms);
	});
}
```

- [ ] **Step 5: 验证 fetchDetail/index.js 语法正确**

```bash
node --check /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/fetchDetail/index.js && echo "syntax OK"
```

预期：`syntax OK`

- [ ] **Step 6: 运行测试回归**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/fetchDetail
node test_extract.js
```

预期：所有测试行均 PASS。

- [ ] **Step 7: 清理临时测试文件**

```bash
rm /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/fetchDetail/test_extract.js
```

- [ ] **Step 8: Commit 第二阶段新增**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler
git add cloudfunctions/fetchDetail/
git commit -m "feat: 新增 fetchDetail 云函数，批量补充采购公告完整原文 HTML"
```

---

## Chunk 3: 集成验证与收尾

### Task 6: 在微信开发者工具中本地调试验证

- [ ] **Step 1: 验证 crawl 函数（手动触发，指定关键字和地区）**

在微信开发者工具的云函数本地调试面板，调用 `crawl` 云函数，传入：

```json
{
  "manual": true,
  "kw": "耗材",
  "region": "四川",
  "start_time": "2026-03-07",
  "end_time": "2026-03-14"
}
```

预期 console 输出关键日志：
```
[Crawl] 开始执行, 手动触发=true
[Crawl] 中国政府采购网 使用 start_time=2026-03-07
[CCGP] 正在抓取第1页
[CCGP] 总页数=X，实际抓取上限=Y
[CCGP] 第1页获取 N 条
[Crawl] 去重后新增 M 条
[Crawl] 执行完成
```

若出现 `CCGP反爬拦截` 警告，等待 10 分钟后重试（本地 IP 可能被临时限制）。

- [ ] **Step 1b: 验证非默认省份（region="广东"）**

调用 `crawl`，传入不同省份，验证 displayZone/zoneId 正确注入：

```json
{
  "manual": true,
  "kw": "耗材",
  "region": "广东",
  "start_time": "2026-03-07",
  "end_time": "2026-03-14"
}
```

在调试面板的 Network 请求或 console 日志中，确认请求 URL 中包含 `displayZone=%E5%B9%BF%E4%B8%9C`（广东 URL 编码）和 `zoneId=44`。同时确认写入的记录 `region` 字段值为 `"广东"` 而非 `"四川"`。

- [ ] **Step 1c: 验证 detectStartDate 自动检测（不传 start_time）**

再次调用 `crawl`，**不传 `start_time`**：

```json
{
  "manual": true,
  "kw": "耗材",
  "region": "四川"
}
```

预期 console 日志应包含：
```
[Crawl] detectStartDate(ccgp): 存量最新日期=YYYY-MM-DD
[Crawl] 中国政府采购网 使用 start_time=YYYY-MM-DD
```

若数据库已有数据（Step 1 写入后），`start_time` 应使用存量数据的最新 `publishDate`，而非默认的 7 天前。

- [ ] **Step 2: 验证数据库中的记录格式**

在微信开发者工具的数据库面板，查看 `procurements` 集合最新记录，逐一确认以下字段：

| 字段 | 预期值 |
|------|--------|
| `contentHtml` | `null` |
| `fetchRetryCount` | `0` |
| `kw` | `"耗材"` |
| `url` | `http://` 开头的完整 URL |
| `crawledAt` | 时间戳（Date 类型） |
| `isChemical` | `true` 或 `false`（布尔值，由 tagItemWithKeywords 填充） |
| `matchedKeywords` | 数组（可为空数组 `[]`） |

若 `isChemical` 字段不存在或为 `undefined`，说明 `index.js` 的 `tagItemWithKeywords`/`matchItem` 调用链路有问题，需排查。

- [ ] **Step 3: 验证 fetchDetail 与 crawl 的端到端链路**

确认 Step 1 已成功写入至少 1 条 `contentHtml=null` 的记录后，在本地调试面板调用 `fetchDetail` 云函数：

```json
{
  "manual": true,
  "batchSize": 3
}
```

预期 console 输出：
```
[FetchDetail] 开始执行, batchSize=3
[FetchDetail] 本批处理 3 条（或更少，取决于 Step 1 写入数量）
[FetchDetail] 完成: {"processed":X,"succeeded":Y,"failed":Z,"abandoned":0}
```

- [ ] **Step 4: 验证 contentHtml 已成功填充**

在数据库面板查看 Step 1 写入的记录，确认：
- `contentHtml` 字段为非空 HTML 字符串（非 `null`，非 `"FETCH_FAILED"`）
- `detailFetchedAt` 为时间戳
- `contentHtml` 长度不超过 200000 字符（在数据库面板可查看字段长度）

- [ ] **Step 5: 验证重试放弃路径（FETCH_FAILED）**

在数据库面板手动插入一条测试记录：

```json
{
  "title": "测试放弃路径",
  "url": "http://invalid.ccgp.gov.cn/nonexistent-page-test-12345.htm",
  "source": "ccgp",
  "contentHtml": null,
  "fetchRetryCount": 4,
  "crawledAt": <当前时间>
}
```

调用 `fetchDetail`（`batchSize=1`），确认该记录被处理后：
- `contentHtml` 变为 `"FETCH_FAILED"`（因为 4+1=5 >= MAX_RETRY_COUNT）
- `fetchRetryCount` 变为 `5`

然后再次调用 `fetchDetail`，确认该记录不再被捞出（已不满足查询条件 `fetchRetryCount < 5`）。

- [ ] **Step 6: 最终 commit**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler
git add -A
git commit -m "chore: 完成 CCGP 爬虫重设计集成验证"
```

---

## 数据库索引（手动操作）

完成开发后，在微信云控制台的数据库管理页面，为 `procurements` 集合添加以下索引（需手动在控制台创建）：

| 字段 | 方向 | 说明 |
|------|------|------|
| `url` | 升序 | 去重查询加速（read-before-write） |
| `contentHtml` | 升序 | fetchDetail 查询空值记录加速 |
| `crawledAt` | 升序 | fetchDetail 按入库时间升序排序加速（与查询 `.orderBy("crawledAt", "asc")` 方向一致） |
