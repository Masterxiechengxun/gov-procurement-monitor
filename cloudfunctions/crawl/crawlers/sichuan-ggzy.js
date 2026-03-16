var baseModule = require("./base");
var BaseCrawler = baseModule.BaseCrawler;
var sleep = baseModule.sleep;

var API_URL = "/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew";

var CATEGORY_MAP = {
	"002002001": "采购公告",
	"002002003": "中标/成交公告"
};

function SichuanGgzyCrawler(config) {
	BaseCrawler.call(this, config);
}

SichuanGgzyCrawler.prototype = Object.create(BaseCrawler.prototype);
SichuanGgzyCrawler.prototype.constructor = SichuanGgzyCrawler;

SichuanGgzyCrawler.prototype.crawl = function(options) {
	var self = this;
	var opts = options || {};
	var pageSize = opts.pageSize || 20;
	var maxPages = opts.maxPages || 2;

	var categories = self.config.categories || Object.keys(CATEGORY_MAP);
	var allItems = [];
	var partialErrors = [];
	var seenUrls = {};

	function crawlCategory(catIndex) {
		if (catIndex >= categories.length) {
			return Promise.resolve({ items: allItems, partialErrors: partialErrors });
		}

		var categoryNum = categories[catIndex];
		var categoryLabel = CATEGORY_MAP[categoryNum] || categoryNum;
		console.log("[四川GGZY] 抓取分类: " + categoryLabel);

		return crawlCategoryPages(self, categoryNum, categoryLabel, pageSize, maxPages, seenUrls, partialErrors)
			.then(function(items) {
				for (var i = 0; i < items.length; i++) {
					allItems.push(items[i]);
				}
				if (catIndex + 1 < categories.length) {
					return sleep(500);
				}
			})
			.then(function() {
				return crawlCategory(catIndex + 1);
			});
	}

	return crawlCategory(0);
};

function crawlCategoryPages(crawler, categoryNum, categoryLabel, pageSize, maxPages, seenUrls, partialErrors) {
	var items = [];

	function crawlPage(pageIndex) {
		if (pageIndex >= maxPages) {
			return Promise.resolve(items);
		}

		var offset = pageIndex * pageSize;
		console.log("[四川GGZY] 请求API: 分类=" + categoryLabel + " 页=" + (pageIndex + 1));

		var now = new Date();
		var endDate = formatDate(now);
		var startDate = formatDate(new Date(now.getTime() - 3 * 86400000));

		var body = buildRequestBody(categoryNum, offset, pageSize, startDate, endDate);

		return crawler.fetch(crawler.config.baseUrl + API_URL, {
			method: "POST",
			data: body,
			headers: {
				"Content-Type": "application/json",
				"Referer": crawler.config.baseUrl + "/jyxx/002002/" + categoryNum + "/transactionInfo.html",
				"Origin": crawler.config.baseUrl
			}
		}).then(function(response) {
			var data = response.data;
			if (typeof data === "string") {
				try {
					data = JSON.parse(data);
				} catch (e) {
					var msg = categoryLabel + " 第" + (pageIndex + 1) + "页: 响应非JSON";
					console.error("[四川GGZY] " + msg);
					partialErrors.push(msg);
					return items;
				}
			}

			var result = data.result || data;
			var records = result.records || [];

			if (records.length === 0) {
				console.log("[四川GGZY] " + categoryLabel + " 无更多数据");
				return items;
			}

			for (var i = 0; i < records.length; i++) {
				var record = records[i];
				var item = parseRecord(record, crawler.config, categoryLabel);
				if (item && !seenUrls[item.url]) {
					seenUrls[item.url] = true;
					items.push(item);
				}
			}

			console.log("[四川GGZY] " + categoryLabel + " 第" + (pageIndex + 1) + "页获取 " + records.length + " 条");

			if (records.length < pageSize) {
				return items;
			}

			if (pageIndex + 1 < maxPages) {
				return sleep(500).then(function() {
					return crawlPage(pageIndex + 1);
				});
			}
			return items;
		}).catch(function(err) {
			var msg = categoryLabel + " 第" + (pageIndex + 1) + "页失败: " + err.message;
			console.error("[四川GGZY] " + msg);
			partialErrors.push(msg);
			return items;
		});
	}

	return crawlPage(0);
}

function buildRequestBody(categoryNum, offset, pageSize, startDate, endDate) {
	return JSON.stringify({
		token: "",
		pn: offset,
		rn: pageSize,
		sdt: "",
		edt: "",
		wd: "",
		inc_wd: "",
		exc_wd: "",
		fields: "",
		cnum: "",
		sort: "{\"ordernum\":\"0\",\"webdate\":\"0\"}",
		ssort: "",
		cl: 200,
		terminal: "",
		condition: [
			{
				fieldName: "categorynum",
				equal: categoryNum,
				notEqual: null,
				equalList: null,
				notEqualList: null,
				isLike: true,
				likeType: 2
			}
		],
		time: [
			{
				fieldName: "webdate",
				startTime: startDate + " 00:00:00",
				endTime: endDate + " 23:59:59"
			}
		],
		highlights: "",
		statistics: null,
		unionCondition: null,
		accuracy: "",
		noParticiple: "1",
		searchRange: null,
		noWd: true
	});
}

function parseRecord(record, config, categoryLabel) {
	var title = record.title || record.titlenew || "";
	if (!title) {
		return null;
	}

	var linkurl = record.linkurl || "";
	if (linkurl && linkurl.indexOf("http") !== 0) {
		linkurl = config.baseUrl + linkurl;
	}
	if (!linkurl) {
		return null;
	}

	var dateStr = "";
	var rawDate = record.webdate || record.infodate || "";
	if (rawDate) {
		var dateMatch = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
		if (dateMatch) {
			dateStr = dateMatch[1] + "-" + dateMatch[2] + "-" + dateMatch[3];
		}
	}

	var source = record.zhuanzai || "四川省公共资源交易信息网";
	var snippet = record.content || title;
	if (snippet.length > 200) {
		snippet = snippet.substring(0, 200);
	}

	return {
		title: title.trim(),
		url: linkurl,
		source: config.id,
		sourceName: config.name,
		publishDate: dateStr,
		region: "四川省",
		buyer: "",
		agent: "",
		bidType: categoryLabel,
		contentSnippet: snippet.trim(),
		dataSource: source
	};
}

function formatDate(date) {
	var y = date.getFullYear();
	var m = date.getMonth() + 1;
	var d = date.getDate();
	return y + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
}

module.exports = SichuanGgzyCrawler;
