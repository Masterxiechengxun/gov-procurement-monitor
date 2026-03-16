var cloud = require("wx-server-sdk");

cloud.init({
	env: cloud.DYNAMIC_CURRENT_ENV
});

var db = cloud.database();
var _ = db.command;

var DEFAULT_SOURCES = [
	{
		id: "ccgp",
		name: "中国政府采购网",
		website: "https://www.ccgp.gov.cn"
	},
	{
		id: "sichuan_ggzy",
		name: "四川省公共资源交易网",
		website: "https://ggzyjy.sc.gov.cn"
	}
];

var DEFAULT_KEYWORDS = {
	"色谱类": ["液相色谱", "气相色谱", "离子色谱", "高效液相", "HPLC", "GC", "超高效液相", "薄层色谱", "UHPLC", "IC"],
	"光谱类": ["原子吸收", "原子荧光", "红外光谱", "紫外光谱", "拉曼光谱", "ICP", "分光光度计", "ICP-OES", "ICP-MS", "AAS", "AFS", "紫外可见"],
	"质谱类": ["质谱仪", "色谱质谱", "气质联用", "液质联用", "GCMS", "LCMS", "三重四极杆", "飞行时间", "TOF"],
	"通用设备": ["天平", "pH计", "电导率仪", "离心机", "恒温箱", "干燥箱", "马弗炉", "水浴锅", "培养箱"],
	"前处理": ["移液器", "滴定仪", "旋转蒸发", "消解仪", "萃取仪", "纯水机", "氮吹仪", "超纯水"],
	"综合类": ["分析仪器", "化学仪器", "实验室设备", "检测仪器", "实验仪器", "检验设备"],
	"高端仪器": ["电子显微镜", "X射线", "XRD", "XRF", "DSC", "TGA", "元素分析", "电化学工作站"],
	"耗材试剂": ["试剂", "标准品", "标准物质", "色谱柱"]
};

var DEFAULT_SCHEDULE = {
	enabled: true,
	dayType: "all"
};

var DEFAULT_RETENTION_DAYS = 90;

exports.main = function(event, context) {
	var wxContext = cloud.getWXContext();
	var openid = wxContext.OPENID;
	var action = event.action || "list";

	var handlers = {
		"list": handleList,
		"detail": handleDetail,
		"stats": handleStats,
		"sources": handleSources,
		"getConfig": handleGetConfig,
		"saveConfig": handleSaveConfig,
		"getSources": handleGetSources,
		"saveSources": handleSaveSources,
		"getKeywords": handleGetKeywords,
		"saveKeywords": handleSaveKeywords,
		"getBlacklistKeywords": handleGetBlacklistKeywords,
		"saveBlacklistKeywords": handleSaveBlacklistKeywords,
		"getSchedule": handleGetSchedule,
		"saveSchedule": handleSaveSchedule,
		"getRetention": handleGetRetention,
		"saveRetention": handleSaveRetention,
		"getFollowedCategories": handleGetFollowedCategories,
		"saveFollowedCategories": handleSaveFollowedCategories,
		"getDisplaySources": handleGetDisplaySources,
		"saveDisplaySources": handleSaveDisplaySources,
		"analytics": handleAnalytics
	};

	var handler = handlers[action];
	if (!handler) {
		return { code: -1, message: "未知操作: " + action, data: null };
	}

	var result = handler(event, context, openid);
	if (result && typeof result.then === "function") {
		return result.catch(function(err) {
			return { code: -1, message: (err && (err.message || err.errMsg || String(err))) || "云函数执行失败", data: null };
		});
	}
	return result;
};

/* ========== 采购数据查询（共享） ========== */

function handleList(event, context, openid) {
	var page = event.page || 1;
	var pageSize = event.pageSize || 20;
	var skip = (page - 1) * pageSize;

	return getConfigValue("blacklist_keywords", openid)
		.then(function(blacklist) {
			var where = buildWhere(event, blacklist);

			var countPromise = db.collection("procurements")
				.where(where)
				.count();

			var listPromise = db.collection("procurements")
				.where(where)
				.orderBy("publishDate", "desc")
				.orderBy("crawledAt", "desc")
				.skip(skip)
				.limit(pageSize)
				.get();

			return Promise.all([countPromise, listPromise]);
		})
		.then(function(results) {
			var total = results[0].total;
			var list = results[1].data;

			var today = getTodayStr();
			for (var i = 0; i < list.length; i++) {
				list[i].isNew = list[i].publishDate === today ||
					(list[i].crawledAt && formatDateStr(list[i].crawledAt) === today);
			}

			return {
				code: 0,
				data: {
					list: list,
					total: total,
					page: page,
					pageSize: pageSize,
					totalPages: Math.ceil(total / pageSize)
				}
			};
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function buildBlacklistCondition(blacklist) {
	if (!blacklist || blacklist.length === 0) {
		return null;
	}
	var escaped = blacklist
		.map(function(w) { return String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); })
		.filter(function(w) { return w.length > 0; });
	if (escaped.length === 0) {
		return null;
	}
	var pattern = escaped.join("|");
	// 使用 _.nor 实现「不包含」：匹配「title 不满足正则」的记录（db.command.not 不支持 RegExp）
	return _.nor([{ title: db.RegExp({ regexp: pattern, options: "i" }) }]);
}

function mergeBlacklistWhere(baseWhere, blacklist) {
	var cond = buildBlacklistCondition(blacklist);
	if (!cond) {
		return baseWhere;
	}
	return Object.keys(baseWhere).length === 0 ? cond : _.and([baseWhere, cond]);
}

function handleDetail(event, context, openid) {
	var id = event.id;
	if (!id) {
		return Promise.resolve({ code: -1, message: "缺少 id 参数", data: null });
	}

	return Promise.all([
		getConfigValue("blacklist_keywords", openid),
		db.collection("procurements").doc(id).get()
	]).then(function(results) {
		var blacklist = results[0] || [];
		var res = results[1];
		var data = res.data;
		if (!data) {
			return { code: 0, data: null };
		}
		if (blacklist.length > 0) {
			var title = (data.title || "").toLowerCase();
			for (var i = 0; i < blacklist.length; i++) {
				if (title.indexOf(String(blacklist[i]).toLowerCase()) !== -1) {
					return { code: 0, data: null };
				}
			}
		}
		return { code: 0, data: data };
	}).catch(function(err) {
		return { code: -1, message: err.message, data: null };
	});
}

function handleStats(event, context, openid) {
	var today = getTodayStr();

	var blacklistPromise = getConfigValue("blacklist_keywords", openid);
	var followedPromise = getConfigValue("followed_categories", openid);
	var keywordsPromise = getConfigValue("custom_keywords", openid);

	return Promise.all([blacklistPromise, followedPromise, keywordsPromise])
		.then(function(preResults) {
			var blacklist = preResults[0] || [];
			var followedCats = preResults[1] || [];
			var keywordsCfg = preResults[2] || DEFAULT_KEYWORDS;

			if (followedCats.length === 0) {
				var allCats = Object.keys(keywordsCfg);
				followedCats = allCats.length > 0 ? [allCats[0]] : [];
			}

			var baseWhere = mergeBlacklistWhere({}, blacklist);
			var totalPromise = db.collection("procurements").where(baseWhere).count();
			var todayPromise = db.collection("procurements")
				.where(mergeBlacklistWhere({ publishDate: today }, blacklist))
				.count();
			var chemicalPromise = db.collection("procurements")
				.where(mergeBlacklistWhere({ isChemical: true }, blacklist))
				.count();
			var todayChemicalPromise = db.collection("procurements")
				.where(mergeBlacklistWhere({ isChemical: true, publishDate: today }, blacklist))
				.count();
			var logPromise = db.collection("crawl_log")
				.orderBy("createdAt", "desc")
				.limit(1)
				.get();

			var catPromises = [];
			for (var i = 0; i < followedCats.length; i++) {
				var catName = followedCats[i];
				var words = keywordsCfg[catName];
				if (words && words.length > 0) {
					catPromises.push(countByCategory(catName, words, blacklist));
				} else {
					catPromises.push(Promise.resolve({ name: catName, count: 0 }));
				}
			}

			return Promise.all([
				totalPromise, todayPromise, chemicalPromise, todayChemicalPromise,
				logPromise, Promise.all(catPromises)
			])
				.then(function(results) {
					var lastLog = results[4].data.length > 0 ? results[4].data[0] : null;
					var catResults = results[5] || [];
					var catCounts = {};
					for (var j = 0; j < catResults.length; j++) {
						catCounts[catResults[j].name] = catResults[j].count;
					}
					return {
						code: 0,
						data: {
							total: results[0].total,
							todayNew: results[1].total,
							chemical: results[2].total,
							todayChemical: results[3].total,
							catCounts: catCounts,
							estimatedSizeKB: Math.round(results[0].total * 1.5),
							lastCrawl: lastLog ? {
								date: lastLog.date,
								duration: lastLog.duration,
								totalFound: lastLog.totalFound || 0,
								newItems: lastLog.newItems,
								matchedItems: lastLog.matchedItems || lastLog.chemicalItems || 0,
								errors: lastLog.errors,
								sourceDetails: lastLog.sourceDetails || []
							} : null
						}
					};
				});
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function countByCategory(catName, keywords, blacklist) {
	var baseWhere = {
		matchedKeywords: _.elemMatch(_.in(keywords))
	};
	var where = mergeBlacklistWhere(baseWhere, blacklist || []);
	return db.collection("procurements")
		.where(where)
		.count()
		.then(function(res) {
			return { name: catName, count: res.total };
		});
}

function handleSources() {
	return Promise.resolve({
		code: 0,
		data: {
			sources: DEFAULT_SOURCES.slice()
		}
	});
}

/* ========== 用户配置（按 openid 隔离） ========== */

function handleGetConfig(event, context, openid) {
	return db.collection("config")
		.where({ _openid: openid })
		.limit(100)
		.get()
		.then(function(res) {
			var config = {};
			for (var i = 0; i < res.data.length; i++) {
				config[res.data[i].key] = res.data[i].value;
			}
			if (Object.keys(config).length > 0) {
				return { code: 0, data: config };
			}
			return db.collection("config")
				.where({
					_openid: _.or(_.exists(false), _.eq(""), _.eq(null))
				})
				.limit(100)
				.get()
				.then(function(legacyRes) {
					var legacyConfig = {};
					for (var j = 0; j < legacyRes.data.length; j++) {
						legacyConfig[legacyRes.data[j].key] = legacyRes.data[j].value;
					}
					return { code: 0, data: legacyConfig };
				});
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleSaveConfig(event, context, openid) {
	var configData = event.config || {};
	var keys = Object.keys(configData);

	function saveNext(index) {
		if (index >= keys.length) {
			return Promise.resolve();
		}
		var key = keys[index];
		var value = configData[key];

		return setConfigValue(key, value, openid)
			.then(function() {
				return saveNext(index + 1);
			});
	}

	return saveNext(0)
		.then(function() {
			return { code: 0, data: null, message: "配置保存成功" };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleGetSources(event, context, openid) {
	return getConfigValue("custom_sources", openid)
		.then(function(val) {
			return {
				code: 0,
				data: val || DEFAULT_SOURCES
			};
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleSaveSources(event, context, openid) {
	var sources = event.sources;
	if (!sources || !Array.isArray(sources)) {
		return Promise.resolve({ code: -1, message: "sources 参数无效", data: null });
	}
	return setConfigValue("custom_sources", sources, openid)
		.then(function() {
			return { code: 0, message: "网站列表保存成功", data: null };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleGetKeywords(event, context, openid) {
	return getConfigValue("custom_keywords", openid)
		.then(function(val) {
			return {
				code: 0,
				data: val || DEFAULT_KEYWORDS
			};
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleSaveKeywords(event, context, openid) {
	var keywords = event.keywords;
	if (!keywords || typeof keywords !== "object") {
		return Promise.resolve({ code: -1, message: "keywords 参数无效", data: null });
	}
	return setConfigValue("custom_keywords", keywords, openid)
		.then(function() {
			return { code: 0, message: "设备关键字保存成功", data: null };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleGetBlacklistKeywords(event, context, openid) {
	if (!openid) {
		return Promise.resolve({ code: 0, data: [] });
	}
	return getConfigValue("blacklist_keywords", openid)
		.then(function(val) {
			return {
				code: 0,
				data: val || []
			};
		})
		.catch(function(err) {
			var msg = (err && (err.message || err.errMsg || String(err))) || "读取黑名单失败";
			return { code: -1, message: msg, data: null };
		});
}

function handleSaveBlacklistKeywords(event, context, openid) {
	var keywords = event.keywords;
	if (!keywords || !Array.isArray(keywords)) {
		return Promise.resolve({ code: -1, message: "keywords 参数无效", data: null });
	}
	return setConfigValue("blacklist_keywords", keywords, openid)
		.then(function() {
			return { code: 0, message: "黑名单保存成功", data: null };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleGetSchedule(event, context, openid) {
	return getConfigValue("crawl_schedule", openid)
		.then(function(val) {
			return {
				code: 0,
				data: val || DEFAULT_SCHEDULE
			};
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleSaveSchedule(event, context, openid) {
	var schedule = event.schedule;
	if (!schedule || typeof schedule !== "object") {
		return Promise.resolve({ code: -1, message: "schedule 参数无效", data: null });
	}
	schedule.updatedAt = new Date().toISOString();
	return setConfigValue("crawl_schedule", schedule, openid)
		.then(function() {
			return { code: 0, message: "抓取策略保存成功", data: null };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleGetRetention(event, context, openid) {
	return getConfigValue("retention_days", openid)
		.then(function(val) {
			return {
				code: 0,
				data: val || DEFAULT_RETENTION_DAYS
			};
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleSaveRetention(event, context, openid) {
	var days = event.days;
	if (!days || typeof days !== "number" || days < 7) {
		return Promise.resolve({ code: -1, message: "保留天数无效（最少 7 天）", data: null });
	}
	return setConfigValue("retention_days", days, openid)
		.then(function() {
			return { code: 0, message: "数据保留期保存成功", data: null };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleGetDisplaySources(event, context, openid) {
	var defaultDisplay = [];
	for (var i = 0; i < DEFAULT_SOURCES.length; i++) {
		defaultDisplay.push({ id: DEFAULT_SOURCES[i].id, name: DEFAULT_SOURCES[i].name });
	}
	return getConfigValue("display_sources", openid)
		.then(function(val) {
			return {
				code: 0,
				data: val || defaultDisplay
			};
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleSaveDisplaySources(event, context, openid) {
	var sources = event.sources;
	if (!sources || !Array.isArray(sources)) {
		return Promise.resolve({ code: -1, message: "sources 参数无效", data: null });
	}
	return setConfigValue("display_sources", sources, openid)
		.then(function() {
			return { code: 0, message: "显示来源保存成功", data: null };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleGetFollowedCategories(event, context, openid) {
	var defaultCats = Object.keys(DEFAULT_KEYWORDS);
	var firstCat = defaultCats.length > 0 ? [defaultCats[0]] : [];
	return getConfigValue("followed_categories", openid)
		.then(function(val) {
			return {
				code: 0,
				data: val || firstCat
			};
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function handleSaveFollowedCategories(event, context, openid) {
	var categories = event.categories;
	if (!categories || !Array.isArray(categories)) {
		return Promise.resolve({ code: -1, message: "categories 参数无效", data: null });
	}
	return setConfigValue("followed_categories", categories, openid)
		.then(function() {
			return { code: 0, message: "关注分类保存成功", data: null };
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

/* ========== 数据分析 ========== */

function handleAnalytics(event, context, openid) {
	var now = new Date();
	var offset = now.getTimezoneOffset();
	var chinaMs = now.getTime() + (offset + 480) * 60000;

	var dates = [];
	for (var i = 6; i >= 0; i--) {
		var d = new Date(chinaMs - i * 86400000);
		var y = d.getFullYear();
		var m = d.getMonth() + 1;
		var day = d.getDate();
		dates.push(y + "-" + (m < 10 ? "0" + m : "" + m) + "-" + (day < 10 ? "0" + day : "" + day));
	}

	return getConfigValue("blacklist_keywords", openid)
		.then(function(blacklist) {
			blacklist = blacklist || [];
			var dailyPromises = [];
			for (var di = 0; di < dates.length; di++) {
				dailyPromises.push(countByDate(dates[di], blacklist));
			}

			var baseWhere = mergeBlacklistWhere({}, blacklist);
			var totalP = db.collection("procurements").where(baseWhere).count();
			var chemP = db.collection("procurements")
				.where(mergeBlacklistWhere({ isChemical: true }, blacklist))
				.count();
			var todayP = db.collection("procurements")
				.where(mergeBlacklistWhere({ publishDate: dates[dates.length - 1] }, blacklist))
				.count();
			var kwP = fetchTopKeywords(blacklist);
			var sourceP = fetchSourceDistribution(blacklist);
			var bidP = fetchBidTypeDistribution(blacklist);
			var followedP = getConfigValue("followed_categories", openid);
			var keywordsP = getConfigValue("custom_keywords", openid);

			return Promise.all([
				totalP, chemP, todayP,
				Promise.all(dailyPromises),
				kwP, sourceP, bidP,
				followedP, keywordsP
			]).then(function(results) {
				return { results: results, blacklist: blacklist };
			});
		})
		.then(function(combined) {
			var results = combined.results;
			var blacklist = combined.blacklist;
			var total = results[0].total;
			var chemical = results[1].total;
			var todayNew = results[2].total;
			var dailyRaw = results[3];
			var topKeywords = results[4];
			var sourceDist = results[5];
			var bidDist = results[6];
			var followedCats = results[7] || [];
			var keywordsCfg = results[8] || DEFAULT_KEYWORDS;

			if (followedCats.length === 0) {
				var allCats = Object.keys(keywordsCfg);
				followedCats = allCats.length > 0 ? [allCats[0]] : [];
			}

			var catPromises = [];
			for (var ci = 0; ci < followedCats.length; ci++) {
				var catName = followedCats[ci];
				var words = keywordsCfg[catName];
				if (words && words.length > 0) {
					catPromises.push(countByCategory(catName, words, blacklist));
				} else {
					catPromises.push(Promise.resolve({ name: catName, count: 0 }));
				}
			}

			var dailyTrend = [];
			for (var k = 0; k < dailyRaw.length; k++) {
				dailyTrend.push({
					date: dates[k],
					count: dailyRaw[k].total,
					chemCount: dailyRaw[k].chem
				});
			}

			return Promise.all(catPromises).then(function(catResults) {
				var catCounts = {};
				for (var j = 0; j < catResults.length; j++) {
					catCounts[catResults[j].name] = catResults[j].count;
				}
				return {
					code: 0,
					data: {
						overview: {
							total: total,
							chemical: chemical,
							todayNew: todayNew,
							catCounts: catCounts
						},
						dailyTrend: dailyTrend,
						topKeywords: topKeywords,
						sourceDistribution: sourceDist,
						bidTypes: bidDist
					}
				};
			});
		})
		.catch(function(err) {
			return { code: -1, message: err.message, data: null };
		});
}

function countByDate(dateStr, blacklist) {
	var baseWhere = { publishDate: dateStr };
	var where = mergeBlacklistWhere(baseWhere, blacklist || []);
	var chemWhere = mergeBlacklistWhere({ publishDate: dateStr, isChemical: true }, blacklist || []);
	var totalP = db.collection("procurements").where(where).count();
	var chemP = db.collection("procurements").where(chemWhere).count();
	return Promise.all([totalP, chemP]).then(function(r) {
		return { total: r[0].total, chem: r[1].total };
	});
}

function fetchTopKeywords(blacklist) {
	var where = mergeBlacklistWhere({ isChemical: true }, blacklist || []);
	return db.collection("procurements")
		.where(where)
		.orderBy("publishDate", "desc")
		.limit(500)
		.field({ matchedKeywords: true })
		.get()
		.then(function(res) {
			var kwCount = {};
			for (var i = 0; i < res.data.length; i++) {
				var kws = res.data[i].matchedKeywords || [];
				for (var j = 0; j < kws.length; j++) {
					kwCount[kws[j]] = (kwCount[kws[j]] || 0) + 1;
				}
			}
			var sorted = Object.keys(kwCount).sort(function(a, b) {
				return kwCount[b] - kwCount[a];
			});
			var top = [];
			for (var k = 0; k < Math.min(sorted.length, 8); k++) {
				top.push({ keyword: sorted[k], count: kwCount[sorted[k]] });
			}
			return top;
		});
}

function fetchSourceDistribution(blacklist) {
	var sourceIds = [];
	var sourceNames = {};
	for (var i = 0; i < DEFAULT_SOURCES.length; i++) {
		sourceIds.push(DEFAULT_SOURCES[i].id);
		sourceNames[DEFAULT_SOURCES[i].id] = DEFAULT_SOURCES[i].name;
	}
	var promises = [];
	for (var j = 0; j < sourceIds.length; j++) {
		promises.push(countBySource(sourceIds[j], blacklist));
	}
	return Promise.all(promises).then(function(results) {
		var dist = [];
		for (var k = 0; k < results.length; k++) {
			if (results[k] > 0) {
				dist.push({
					source: sourceIds[k],
					name: sourceNames[sourceIds[k]] || sourceIds[k],
					count: results[k]
				});
			}
		}
		dist.sort(function(a, b) { return b.count - a.count; });
		return dist;
	});
}

function countBySource(sourceId, blacklist) {
	var where = mergeBlacklistWhere({ source: sourceId }, blacklist || []);
	return db.collection("procurements")
		.where(where)
		.count()
		.then(function(res) { return res.total; });
}

function fetchBidTypeDistribution(blacklist) {
	var baseWhere = mergeBlacklistWhere({}, blacklist || []);
	return db.collection("procurements")
		.where(baseWhere)
		.orderBy("publishDate", "desc")
		.limit(1000)
		.field({ bidType: true })
		.get()
		.then(function(res) {
			var typeCount = {};
			for (var i = 0; i < res.data.length; i++) {
				var bt = res.data[i].bidType;
				if (bt) {
					typeCount[bt] = (typeCount[bt] || 0) + 1;
				}
			}
			var sorted = Object.keys(typeCount).sort(function(a, b) {
				return typeCount[b] - typeCount[a];
			});
			var dist = [];
			for (var j = 0; j < sorted.length; j++) {
				dist.push({ type: sorted[j], count: typeCount[sorted[j]] });
			}
			return dist;
		});
}

/* ========== 配置存取（含 openid 隔离 + 向后兼容） ========== */

function getConfigValue(key, openid) {
	return db.collection("config")
		.where({ key: key, _openid: openid })
		.limit(1)
		.get()
		.then(function(res) {
			if (res.data.length > 0) {
				return res.data[0].value;
			}
			return db.collection("config")
				.where({
					key: key,
					_openid: _.or(_.exists(false), _.eq(""), _.eq(null))
				})
				.limit(1)
				.get()
				.then(function(legacyRes) {
					if (legacyRes.data.length > 0) {
						return legacyRes.data[0].value;
					}
					return null;
				});
		});
}

function setConfigValue(key, value, openid) {
	return db.collection("config")
		.where({ key: key, _openid: openid })
		.limit(1)
		.get()
		.then(function(res) {
			if (res.data.length > 0) {
				return db.collection("config")
					.doc(res.data[0]._id)
					.update({ data: { value: value, updatedAt: new Date() } });
			} else {
				return db.collection("config")
					.add({ data: { key: key, value: value, _openid: openid, createdAt: new Date() } });
			}
		});
}

/* ========== 工具函数 ========== */

function buildWhere(event, blacklist) {
	var where = {};

	if (event.source) {
		where.source = event.source;
	}

	if (event.matchKeywords && event.matchKeywords.length > 0) {
		where.matchedKeywords = _.elemMatch(_.in(event.matchKeywords));
	} else if (event.chemicalOnly) {
		where.isChemical = true;
	}

	if (event.dateFrom && event.dateTo) {
		where.publishDate = _.gte(event.dateFrom).and(_.lte(event.dateTo));
	} else if (event.dateFrom) {
		where.publishDate = _.gte(event.dateFrom);
	} else if (event.dateTo) {
		where.publishDate = _.lte(event.dateTo);
	}

	if (event.keyword) {
		var escaped = event.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		where.title = db.RegExp({
			regexp: escaped,
			options: "i"
		});
	}

	var blacklistCond = buildBlacklistCondition(blacklist);
	if (blacklistCond) {
		where = _.and([where, blacklistCond]);
	}

	return where;
}

function getTodayStr() {
	var now = new Date();
	var offset = now.getTimezoneOffset();
	var chinaTime = new Date(now.getTime() + (offset + 480) * 60000);
	var y = chinaTime.getFullYear();
	var m = chinaTime.getMonth() + 1;
	var d = chinaTime.getDate();
	return y + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
}

function formatDateStr(date) {
	if (typeof date === "string") {
		return date.substring(0, 10);
	}
	if (date instanceof Date) {
		var offset = date.getTimezoneOffset();
		var chinaTime = new Date(date.getTime() + (offset + 480) * 60000);
		var y = chinaTime.getFullYear();
		var m = chinaTime.getMonth() + 1;
		var d = chinaTime.getDate();
		return y + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
	}
	return "";
}
