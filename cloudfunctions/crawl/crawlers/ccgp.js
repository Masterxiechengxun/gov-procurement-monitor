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
			detailFetchedAt: null
			// crawledAt 由 index.js 的 deduplicateAndSave 统一写入，此处无需重复设置
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
