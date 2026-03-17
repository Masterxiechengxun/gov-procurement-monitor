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

	var crawlOptions = {
		kw:         event.kw,
		region:     event.region,
		start_time: event.start_time,
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

function executeCrawl(crawlOptions) {
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

			return crawlAllSources(crawlSources, crawlResults, mergedKeywords, crawlOptions);
		})
		.then(function() {
			return sendAllNotifications(crawlResults, allUsersConfig);
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
 * 聚合所有用户配置的来源，决定本次抓取哪些网站。
 * custom_sources 存储用户启用的来源 ID 列表（由小程序设置页写入）。
 * 若数据库中无任何用户配置，则默认使用全部内置来源（ccgp + sichuan_ggzy）。
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

	// 无用户配置时回退到全部内置来源
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
 * 合并所有用户的抓取关键字，用于：
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
			var currentDay = now.getDay();
			var isWeekend = currentDay === 0 || currentDay === 6;

			var anyEnabled = false;

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

				return true;
			}

			if (!anyEnabled) {
				console.log("[Crawl] 所有用户均已禁用自动抓取");
			} else {
				console.log("[Crawl] 今日不满足任何用户的执行日期设置");
			}
			return false;
		})
		.catch(function(err) {
			console.warn("[Crawl] 检查抓取策略失败，默认执行:", err.message);
			return true;
		});
}

function getChinaTime() {
	var now = new Date();
	var offset = now.getTimezoneOffset();
	return new Date(now.getTime() + (offset + 480) * 60000);
}

/* ========== 全量抓取执行 ========== */

function crawlAllSources(sources, results, mergedKeywords, crawlOptions) {
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

		var startTimePromise = (crawlOptions && crawlOptions.start_time)
			? Promise.resolve(crawlOptions.start_time)
			: detectStartDate(source.id);

		return startTimePromise.then(function(resolvedStartTime) {
			var sourceOptions = Object.assign({}, crawlOptions || {}, { start_time: resolvedStartTime });
			console.log("[Crawl] " + source.name + " 使用 start_time=" + resolvedStartTime);
			return crawler.crawl(sourceOptions);
		}).then(function(crawlResult) {
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
/**
 * 统一推送入口，合并成功通知和错误通知为单条消息。
 * 场景判断逻辑在 notifier.buildReport 内部执行。
 */
function sendAllNotifications(results, userMap) {
	var users = Object.keys(userMap);
	var stats = {
		total: results.total || 0,
		newItems: results.newItems || 0
	};

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

		// results._matchedNewItems 由 deduplicateAndSave 在抓取阶段动态附加，
		// 收集了命中任意用户关键字的新增条目；若无命中则不存在该字段，|| [] 兜底
		var userItems = filterItemsByUserKeywords(
			results._matchedNewItems || [],
			config["custom_keywords"]
		);
		var blacklist = config["blacklist_keywords"];
		userItems = filterItemsByBlacklist(userItems, blacklist);

		// 预检场景 4：无命中且无错误来源，跳过（notifier 内部也会做此判断，此处提前跳过避免无意义调用）
		var hasErrors = results.sourceDetails && results.sourceDetails.some(function(s) {
			return s.status !== "success";
		});
		if (userItems.length === 0 && !hasErrors) {
			console.log("[Crawl] 用户 " + uid.substring(0, 8) + "... 无命中且无错误，跳过推送");
			return notifyNext(idx + 1);
		}

		var uidShort = uid.length > 8 ? uid.substring(0, 8) + "..." : uid;
		console.log("[Crawl] 向用户 " + uidShort + " 推送（命中 " + userItems.length + " 条，错误来源 " + (hasErrors ? ">0" : "0") + "）");

		return notifier.sendNotification(token, userItems, results.sourceDetails || [], stats)
			.then(function() {
				return notifyNext(idx + 1);
			});
	}

	return notifyNext(0);
}

var DEFAULT_BLACKLIST = ["医院"];

/**
 * 按黑名单过滤条目，排除标题包含黑名单关键字的采购信息。
 * 黑名单为空时使用默认 ["医院"]。
 */
function filterItemsByBlacklist(items, blacklist) {
	var list = (blacklist && Array.isArray(blacklist) && blacklist.length > 0) ? blacklist : DEFAULT_BLACKLIST;
	var filtered = [];
	var titleLower;
	for (var i = 0; i < items.length; i++) {
		titleLower = (items[i].title || "").toLowerCase();
		var hit = false;
		for (var j = 0; j < list.length; j++) {
			if (titleLower.indexOf(String(list[j]).toLowerCase()) !== -1) {
				hit = true;
				break;
			}
		}
		if (!hit) {
			filtered.push(items[i]);
		}
	}
	return filtered;
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
			// 校验格式必须是 YYYY-MM-DD，防止历史脏数据导致 formatCcgpDate 转换错误
			if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) {
				var fallback = getDefaultCrawlDate(-7);
				console.warn("[Crawl] detectStartDate(" + sourceId + "): publishDate 格式异常 '" + latestDate + "'，使用默认 " + fallback);
				return fallback;
			}
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
