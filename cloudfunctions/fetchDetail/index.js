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
	// Referer 使用 CCGP 域名。当前仅 CCGP 来源的记录设有 contentHtml: null，
	// sichuan_ggzy 来源不设置 contentHtml 字段，故不会被 fetchPendingItems 查询到。
	// 若将来新增其他来源且同样需要补抓，需根据 item.source 动态选择 Referer。
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
