var cheerio = require("cheerio");
var baseModule = require("./base");
var BaseCrawler = baseModule.BaseCrawler;
var sleep = baseModule.sleep;

function CcgpCrawler(config) {
	BaseCrawler.call(this, config);
}

CcgpCrawler.prototype = Object.create(BaseCrawler.prototype);
CcgpCrawler.prototype.constructor = CcgpCrawler;

CcgpCrawler.prototype.crawl = function(options) {
	var self = this;
	var opts = options || {};
	var dateFrom = opts.dateFrom || getDefaultDateFrom();
	var dateTo = opts.dateTo || formatCcgpDate(new Date());
	var maxPages = opts.maxPages || 5;

	var allItems = [];
	var partialErrors = [];
	var seenUrls = {};

	return crawlPages(self, dateFrom, dateTo, maxPages, seenUrls, partialErrors)
		.then(function(items) {
			for (var i = 0; i < items.length; i++) {
				allItems.push(items[i]);
			}
			return { items: allItems, partialErrors: partialErrors };
		});
};

function crawlPages(crawler, dateFrom, dateTo, maxPages, seenUrls, partialErrors) {
	var items = [];

	function crawlPage(page) {
		if (page > maxPages) {
			return Promise.resolve(items);
		}

		var params = Object.assign({}, crawler.config.params, {
			start_time: dateFrom,
			end_time: dateTo,
			timeType: "6",
			page_index: String(page)
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

			var pageItems = parseCcgpList(html, crawler.config);

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

		if (page < maxPages) {
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

function parseCcgpList(html, config) {
	var $ = cheerio.load(html);
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
			region: info.region || "四川省",
			buyer: info.buyer || "",
			agent: info.agent || "",
			bidType: info.bidType || "",
			contentSnippet: cleanText(title)
		});
	});

	return items;
}

function parseMetaText(text) {
	var info = {
		date: "",
		buyer: "",
		agent: "",
		bidType: "",
		region: ""
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

	var regionMatch = text.match(/(四川省[\-\s]*[\u4e00-\u9fa5]*[市州县区])/);
	if (regionMatch) {
		info.region = regionMatch[1];
	} else if (text.indexOf("四川") !== -1) {
		info.region = "四川省";
	}

	return info;
}

function cleanText(text) {
	if (!text) {
		return "";
	}
	return text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function formatCcgpDate(date) {
	var y = date.getFullYear();
	var m = date.getMonth() + 1;
	var d = date.getDate();
	return y + "%3A" + (m < 10 ? "0" + m : m) + "%3A" + (d < 10 ? "0" + d : d);
}

function getDefaultDateFrom() {
	var date = new Date();
	date.setDate(date.getDate() - 3);
	return formatCcgpDate(date);
}

module.exports = CcgpCrawler;
