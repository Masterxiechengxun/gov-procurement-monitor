var cloud = require("wx-server-sdk");
var CcgpCrawler = require("./crawlers/ccgp");
var SichuanGgzyCrawler = require("./crawlers/sichuan-ggzy");
var sourcesConfig = require("./config/sources");
var keywordsConfig = require("./config/keywords");
var matcher = require("./utils/matcher");
var notifier = require("./utils/notifier");

cloud.init({
	env: cloud.DYNAMIC_CURRENT_ENV
});

var db = cloud.database();
var _ = db.command;

var CRAWLER_MAP = {
	"ccgp": CcgpCrawler,
	"sichuan_ggzy": SichuanGgzyCrawler
};

exports.main = function(event, context) {
	var isManual = event.manual || false;
	console.log("[Crawl] 开始执行, 手动触发=" + isManual);

	if (!isManual) {
		return checkSchedule().then(function(shouldRun) {
			if (!shouldRun) {
				console.log("[Crawl] 当前不满足抓取策略条件，跳过执行");
				return { code: 0, message: "跳过执行（不满足策略条件）", data: null };
			}
			return executeCrawl();
		});
	}

	return executeCrawl();
};

function executeCrawl() {
	var startTime = Date.now();
	var crawlResults = {
		total: 0,
		newItems: 0,
		matchedItems: 0,
		errors: [],
		sourceDetails: []
	};
	var allUsersConfig = null;

	return loadAllUsersConfig()
		.then(function(userMap) {
			allUsersConfig = userMap;
			var crawlSources = aggregateSources(userMap);
			var mergedKeywords = mergeAllKeywords(userMap);

			return crawlAllSources(crawlSources, crawlResults, mergedKeywords);
		})
		.then(function() {
			return sendNotifications(crawlResults, allUsersConfig);
		})
		.then(function() {
			return sendErrorNotifications(crawlResults, allUsersConfig);
		})
		.then(function() {
			return saveCrawlLog(crawlResults, startTime);
		})
		.then(function() {
			console.log("[Crawl] 执行完成, 总耗时=" + (Date.now() - startTime) + "ms");
			return {
				code: 0,
				message: "抓取完成",
				data: {
					total: crawlResults.total,
					newItems: crawlResults.newItems,
					matchedItems: crawlResults.matchedItems,
					errors: crawlResults.errors,
					sourceDetails: crawlResults.sourceDetails,
					duration: Date.now() - startTime
				}
			};
		})
		.catch(function(err) {
			console.error("[Crawl] 执行失败: " + err.message);
			return {
				code: -1,
				message: "抓取失败: " + err.message,
				data: null
			};
		});
}

/* ========== 多用户配置加载 ========== */

function loadAllUsersConfig() {
	var allRecords = [];

	function fetchBatch(offset) {
		return db.collection("config")
			.skip(offset)
			.limit(100)
			.get()
			.then(function(res) {
				for (var i = 0; i < res.data.length; i++) {
					allRecords.push(res.data[i]);
				}
				if (res.data.length === 100) {
					return fetchBatch(offset + 100);
				}
			});
	}

	return fetchBatch(0)
		.then(function() {
			var userMap = {};
			for (var i = 0; i < allRecords.length; i++) {
				var record = allRecords[i];
				var uid = record._openid || "__global__";
				if (!userMap[uid]) {
					userMap[uid] = {};
				}
				userMap[uid][record.key] = record.value;
			}
			return userMap;
		})
		.catch(function(err) {
			console.warn("[Crawl] 读取配置失败，使用默认配置:", err.message);
			return {};
		});
}

/**
 * 聚合所有用户配置的来源，从数据库动态获取要抓取的网站。
 * sources.js 仅作为爬虫技术注册表（baseUrl、params 等实现细节），
 * 用户在设置页管理的来源（custom_sources）决定抓取哪些网站。
 * 若数据库中无任何用户配置，则使用 sources.js 中的全部来源作为兜底。
 */
function aggregateSources(userMap) {
	var sourceMap = {};
	var users = Object.keys(userMap);

	for (var i = 0; i < users.length; i++) {
		var sources = userMap[users[i]]["custom_sources"];
		if (sources && Array.isArray(sources)) {
			for (var j = 0; j < sources.length; j++) {
				if (!sourceMap[sources[j].id]) {
					sourceMap[sources[j].id] = sources[j];
				}
			}
		}
	}

	if (Object.keys(sourceMap).length === 0) {
		return sourcesConfig.getEnabledSources();
	}

	var result = [];
	var ids = Object.keys(sourceMap);
	for (var k = 0; k < ids.length; k++) {
		var builtIn = sourcesConfig.getSourceById(ids[k]);
		if (builtIn) {
			result.push(builtIn);
		}
	}
	return result.length > 0 ? result : sourcesConfig.getEnabledSources();
}

/**
 * 合并所有用户的设备关键字，用于：
 * 1. 存库时给采购信息打标签（isChemical / matchedKeywords），方便前端快速过滤
 * 2. 推送前预筛选——只有命中任一用户关键字的条目才进入推送候选
 * 注意：这里不影响抓取范围，抓取本身是全量的。
 */
function mergeAllKeywords(userMap) {
	var merged = {};
	var users = Object.keys(userMap);

	for (var i = 0; i < users.length; i++) {
		var kw = userMap[users[i]]["custom_keywords"];
		if (kw && typeof kw === "object") {
			var cats = Object.keys(kw);
			for (var j = 0; j < cats.length; j++) {
				if (!merged[cats[j]]) {
					merged[cats[j]] = [];
				}
				var words = kw[cats[j]];
				for (var k = 0; k < words.length; k++) {
					if (merged[cats[j]].indexOf(words[k]) === -1) {
						merged[cats[j]].push(words[k]);
					}
				}
			}
		}
	}

	return Object.keys(merged).length > 0 ? merged : null;
}

/* ========== 定时策略检查 ========== */

function checkSchedule() {
	return db.collection("config")
		.where({ key: "crawl_schedule" })
		.limit(100)
		.get()
		.then(function(res) {
			if (res.data.length === 0) {
				return true;
			}

			var now = getChinaTime();
			var currentHour = now.getHours();
			var currentDay = now.getDay();
			var isWeekend = currentDay === 0 || currentDay === 6;

			var anyEnabled = false;
			var shouldRunByHour = false;
			var minInterval = 24;

			for (var i = 0; i < res.data.length; i++) {
				var schedule = res.data[i].value;
				if (!schedule || !schedule.enabled) {
					continue;
				}
				anyEnabled = true;

				if (schedule.dayType === "workday" && isWeekend) {
					continue;
				}
				if (schedule.dayType === "weekend" && !isWeekend) {
					continue;
				}

				var interval = schedule.intervalHours || 24;
				if (interval < minInterval) {
					minInterval = interval;
				}

				if (isMatchingHour(currentHour, schedule)) {
					shouldRunByHour = true;
				}
			}

			if (!anyEnabled) {
				console.log("[Crawl] 所有用户均已禁用自动抓取");
				return false;
			}

			if (!shouldRunByHour) {
				console.log("[Crawl] 当前时间不匹配任何用户的执行小时");
				return false;
			}

			var realNow = new Date();
			return db.collection("crawl_log")
				.orderBy("createdAt", "desc")
				.limit(1)
				.get()
				.then(function(logRes) {
					if (logRes.data.length === 0) {
						return true;
					}

					var lastCrawlTime = logRes.data[0].createdAt;
					if (typeof lastCrawlTime === "string") {
						lastCrawlTime = new Date(lastCrawlTime);
					}
					var hoursSinceLast = (realNow.getTime() - lastCrawlTime.getTime()) / 3600000;

					if (hoursSinceLast < minInterval - 0.5) {
						console.log("[Crawl] 距上次抓取 " + Math.round(hoursSinceLast * 10) / 10 + " 小时，不足最小间隔 " + minInterval + " 小时");
						return false;
					}

					return true;
				});
		})
		.catch(function(err) {
			console.warn("[Crawl] 检查抓取策略失败，默认执行:", err.message);
			return true;
		});
}

function isMatchingHour(currentHour, schedule) {
	var startHour = schedule.startHour;
	if (typeof startHour !== "number") {
		startHour = 6;
	}
	var intervalHours = schedule.intervalHours || 24;

	if (intervalHours >= 24) {
		return currentHour === startHour;
	}

	var diff = currentHour - startHour;
	if (diff < 0) {
		diff += 24;
	}
	return diff % intervalHours === 0;
}

function getChinaTime() {
	var now = new Date();
	var offset = now.getTimezoneOffset();
	return new Date(now.getTime() + (offset + 480) * 60000);
}

/* ========== 全量抓取执行 ========== */

function crawlAllSources(sources, results, mergedKeywords) {
	function crawlNext(index) {
		if (index >= sources.length) {
			return Promise.resolve();
		}

		var source = sources[index];
		console.log("[Crawl] 开始抓取: " + source.name);

		var sourceDetail = {
			sourceId: source.id,
			sourceName: source.name,
			itemsFound: 0,
			newItems: 0,
			matchedItems: 0,
			status: "success",
			errorMessage: ""
		};

		var CrawlerClass = CRAWLER_MAP[source.id];
		if (!CrawlerClass) {
			console.warn("[Crawl] 未找到爬虫实现: " + source.id);
			sourceDetail.status = "error";
			sourceDetail.errorMessage = "未找到爬虫实现";
			results.sourceDetails.push(sourceDetail);
			results.errors.push({ source: source.id, message: "未找到爬虫实现" });
			return crawlNext(index + 1);
		}

		var crawler = new CrawlerClass(source);
		var prevNewItems = results.newItems;
		var prevMatchedItems = results.matchedItems;

		return crawler.crawl({})
			.then(function(crawlResult) {
				var items, partialErrors;
				if (Array.isArray(crawlResult)) {
					items = crawlResult;
					partialErrors = [];
				} else {
					items = crawlResult.items || [];
					partialErrors = crawlResult.partialErrors || [];
				}

				console.log("[Crawl] " + source.name + " 抓取到 " + items.length + " 条数据");
				sourceDetail.itemsFound = items.length;
				results.total += items.length;

				if (partialErrors.length > 0) {
					sourceDetail.status = "partial";
					sourceDetail.errorMessage = partialErrors.length + " 页请求失败";
					for (var i = 0; i < partialErrors.length; i++) {
						results.errors.push({ source: source.id, message: partialErrors[i] });
					}
				}

				return deduplicateAndSave(items, results, mergedKeywords);
			})
			.then(function() {
				sourceDetail.newItems = results.newItems - prevNewItems;
				sourceDetail.matchedItems = results.matchedItems - prevMatchedItems;
				results.sourceDetails.push(sourceDetail);
			})
			.catch(function(err) {
				console.error("[Crawl] " + source.name + " 抓取失败: " + err.message);
				sourceDetail.status = "error";
				sourceDetail.errorMessage = err.message;
				results.sourceDetails.push(sourceDetail);
				results.errors.push({ source: source.id, message: err.message });
			})
			.then(function() {
				return crawlNext(index + 1);
			});
	}

	return crawlNext(0);
}

/* ========== 去重与存储 ========== */

/**
 * 全量存储：所有抓取到的新数据都入库。
 * 关键字标签：用合并后的所有用户关键字给条目打标（isChemical/matchedKeywords），
 * 仅用于前端筛选展示和推送预筛选，不影响入库范围。
 */
function deduplicateAndSave(items, results, mergedKeywords) {
	if (items.length === 0) {
		return Promise.resolve();
	}

	var urls = [];
	for (var i = 0; i < items.length; i++) {
		urls.push(items[i].url);
	}

	return batchCheckUrls(urls)
		.then(function(existingUrls) {
			var newItems = [];
			for (var i = 0; i < items.length; i++) {
				if (!existingUrls[items[i].url]) {
					var item = items[i];
					if (mergedKeywords) {
						tagItemWithKeywords(item, mergedKeywords);
					} else {
						matcher.matchItem(item);
					}
					item.crawledAt = new Date();
					newItems.push(item);
				}
			}

			console.log("[Crawl] 去重后新增 " + newItems.length + " 条");
			results.newItems += newItems.length;

			if (newItems.length === 0) {
				return;
			}

			var matchedNewItems = [];
			for (var j = 0; j < newItems.length; j++) {
				if (newItems[j].isChemical) {
					matchedNewItems.push(newItems[j]);
				}
			}
			results.matchedItems += matchedNewItems.length;
			console.log("[Crawl] 其中关键字命中 " + matchedNewItems.length + " 条");

			if (!results._matchedNewItems) {
				results._matchedNewItems = [];
			}
			for (var k = 0; k < matchedNewItems.length; k++) {
				results._matchedNewItems.push(matchedNewItems[k]);
			}

			return batchInsert(newItems);
		});
}

/**
 * 给条目打关键字标签。
 * isChemical=true 表示命中了至少一个用户的关键字，
 * matchedKeywords 记录具体命中了哪些词。
 */
function tagItemWithKeywords(item, keywordObj) {
	var allWords = [];
	var categories = Object.keys(keywordObj);
	for (var i = 0; i < categories.length; i++) {
		var words = keywordObj[categories[i]];
		for (var j = 0; j < words.length; j++) {
			if (allWords.indexOf(words[j]) === -1) {
				allWords.push(words[j]);
			}
		}
	}

	var searchText = ((item.title || "") + " " + (item.contentSnippet || "")).toLowerCase();
	var matched = [];
	for (var k = 0; k < allWords.length; k++) {
		if (searchText.indexOf(allWords[k].toLowerCase()) !== -1) {
			matched.push(allWords[k]);
		}
	}

	item.isChemical = matched.length > 0;
	item.matchedKeywords = matched;
}

function batchCheckUrls(urls) {
	var existingUrls = {};
	var batchSize = 20;

	function checkBatch(startIndex) {
		if (startIndex >= urls.length) {
			return Promise.resolve(existingUrls);
		}

		var batch = urls.slice(startIndex, startIndex + batchSize);

		return db.collection("procurements")
			.where({ url: _.in(batch) })
			.field({ url: true })
			.get()
			.then(function(res) {
				var data = res.data;
				for (var i = 0; i < data.length; i++) {
					existingUrls[data[i].url] = true;
				}
				return checkBatch(startIndex + batchSize);
			});
	}

	return checkBatch(0);
}

function batchInsert(items) {
	var index = 0;

	function insertNext() {
		if (index >= items.length) {
			return Promise.resolve();
		}

		var item = items[index];
		index++;

		return db.collection("procurements")
			.add({ data: item })
			.then(function() {
				return insertNext();
			})
			.catch(function(err) {
				console.error("[Crawl] 插入数据失败: " + err.message);
				return insertNext();
			});
	}

	return insertNext();
}

/* ========== 按用户推送通知 ========== */

/**
 * 推送逻辑：
 * 1. 从本次全量抓取的新增数据中，筛选出命中任一用户关键字的条目（_matchedNewItems）
 * 2. 对每个配置了 PushPlus token 的用户，用该用户自己的关键字再次过滤
 * 3. 只推送该用户真正关注的内容
 */
function sendNotifications(results, userMap) {
	var matchedItems = results._matchedNewItems || [];
	if (matchedItems.length === 0) {
		console.log("[Crawl] 无新增关键字命中采购信息，不推送");
		return Promise.resolve();
	}

	var users = Object.keys(userMap);

	function notifyNext(idx) {
		if (idx >= users.length) {
			return Promise.resolve();
		}

		var uid = users[idx];
		var config = userMap[uid];
		var token = config["pushplus_token"];

		if (!token) {
			return notifyNext(idx + 1);
		}

		var userKeywords = config["custom_keywords"];
		var userItems = filterItemsByUserKeywords(matchedItems, userKeywords);

		if (userItems.length === 0) {
			return notifyNext(idx + 1);
		}

		var uidShort = uid.length > 8 ? uid.substring(0, 8) + "..." : uid;
		console.log("[Crawl] 向用户 " + uidShort + " 推送 " + userItems.length + " 条");

		return notifier.sendNotification(token, userItems)
			.then(function() {
				return notifyNext(idx + 1);
			});
	}

	return notifyNext(0);
}

function sendErrorNotifications(results, userMap) {
	if (results.errors.length === 0) {
		return Promise.resolve();
	}

	var users = Object.keys(userMap);
	var stats = {
		total: results.total,
		newItems: results.newItems,
		matchedItems: results.matchedItems
	};

	function notifyNext(idx) {
		if (idx >= users.length) {
			return Promise.resolve();
		}

		var uid = users[idx];
		var token = userMap[uid]["pushplus_token"];

		if (!token) {
			return notifyNext(idx + 1);
		}

		return notifier.sendErrorNotification(token, results.sourceDetails, results.errors, stats)
			.then(function() {
				return notifyNext(idx + 1);
			});
	}

	return notifyNext(0);
}

/**
 * 按用户自己的关键字过滤条目，只返回匹配该用户关注内容的采购信息。
 */
function filterItemsByUserKeywords(items, userKeywords) {
	if (!userKeywords || typeof userKeywords !== "object") {
		return items;
	}

	var allWords = [];
	var cats = Object.keys(userKeywords);
	for (var i = 0; i < cats.length; i++) {
		var words = userKeywords[cats[i]];
		for (var j = 0; j < words.length; j++) {
			if (allWords.indexOf(words[j]) === -1) {
				allWords.push(words[j]);
			}
		}
	}

	if (allWords.length === 0) {
		return items;
	}

	var filtered = [];
	for (var k = 0; k < items.length; k++) {
		var searchText = ((items[k].title || "") + " " + (items[k].contentSnippet || "")).toLowerCase();
		for (var m = 0; m < allWords.length; m++) {
			if (searchText.indexOf(allWords[m].toLowerCase()) !== -1) {
				filtered.push(items[k]);
				break;
			}
		}
	}
	return filtered;
}

/* ========== 日志记录 ========== */

function saveCrawlLog(results, startTime) {
	var today = getChinaTime();
	var dateStr = today.getFullYear() + "-" +
		(today.getMonth() + 1 < 10 ? "0" + (today.getMonth() + 1) : today.getMonth() + 1) + "-" +
		(today.getDate() < 10 ? "0" + today.getDate() : today.getDate());

	return db.collection("crawl_log")
		.add({
			data: {
				date: dateStr,
				totalFound: results.total,
				newItems: results.newItems,
				matchedItems: results.matchedItems,
				errors: results.errors,
				sourceDetails: results.sourceDetails,
				duration: Date.now() - startTime,
				createdAt: new Date()
			}
		})
		.then(function() {
			console.log("[Crawl] 抓取日志已记录");
		})
		.catch(function(err) {
			console.error("[Crawl] 记录抓取日志失败: " + err.message);
		});
}
