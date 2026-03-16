function callCloud(name, data) {
	return new Promise(function(resolve, reject) {
		wx.cloud.callFunction({
			name: name,
			data: data || {},
			success: function(res) {
				if (res.result && res.result.code === 0) {
					resolve(res.result.data);
				} else {
					var errMsg = (res.result && res.result.message) || (res.result && res.result.errMsg) || "请求失败";
					reject(new Error(errMsg));
				}
			},
			fail: function(err) {
				reject(err);
			}
		});
	});
}

function getList(params) {
	var data = {
		action: "list",
		page: params.page || 1,
		pageSize: params.pageSize || 20,
		source: params.source || "",
		dateFrom: params.dateFrom || "",
		dateTo: params.dateTo || "",
		chemicalOnly: params.chemicalOnly || false,
		keyword: params.keyword || ""
	};
	if (params.matchKeywords && params.matchKeywords.length > 0) {
		data.matchKeywords = params.matchKeywords;
	}
	return callCloud("getData", data);
}

function getDetail(id) {
	return callCloud("getData", {
		action: "detail",
		id: id
	});
}

function getStats() {
	return callCloud("getData", {
		action: "stats"
	});
}

function getSources() {
	return callCloud("getData", {
		action: "sources"
	});
}

function getConfig() {
	return callCloud("getData", {
		action: "getConfig"
	});
}

function saveConfig(configData) {
	return callCloud("getData", {
		action: "saveConfig",
		config: configData
	});
}

function getCustomSources() {
	return callCloud("getData", {
		action: "getSources"
	});
}

function saveCustomSources(sources) {
	return callCloud("getData", {
		action: "saveSources",
		sources: sources
	});
}

function getCustomKeywords() {
	return callCloud("getData", {
		action: "getKeywords"
	});
}

function saveCustomKeywords(keywords) {
	return callCloud("getData", {
		action: "saveKeywords",
		keywords: keywords
	});
}

function getSchedule() {
	return callCloud("getData", {
		action: "getSchedule"
	});
}

function saveSchedule(schedule) {
	return callCloud("getData", {
		action: "saveSchedule",
		schedule: schedule
	});
}

function getRetention() {
	return callCloud("getData", {
		action: "getRetention"
	});
}

function saveRetention(days) {
	return callCloud("getData", {
		action: "saveRetention",
		days: days
	});
}

function getDisplaySources() {
	return callCloud("getData", {
		action: "getDisplaySources"
	});
}

function saveDisplaySources(sources) {
	return callCloud("getData", {
		action: "saveDisplaySources",
		sources: sources
	});
}

function getFollowedCategories() {
	return callCloud("getData", {
		action: "getFollowedCategories"
	});
}

function getBlacklistKeywords() {
	return callCloud("getData", {
		action: "getBlacklistKeywords"
	});
}

function saveBlacklistKeywords(keywords) {
	return callCloud("getData", {
		action: "saveBlacklistKeywords",
		keywords: keywords
	});
}

function saveFollowedCategories(categories) {
	return callCloud("getData", {
		action: "saveFollowedCategories",
		categories: categories
	});
}

function getAnalytics() {
	return callCloud("getData", {
		action: "analytics"
	});
}

function triggerCrawl() {
	return new Promise(function(resolve, reject) {
		wx.cloud.callFunction({
			name: "crawl",
			data: { manual: true },
			timeout: 300000,
			success: function(res) {
				resolve(res.result);
			},
			fail: function(err) {
				reject(err);
			}
		});
	});
}

module.exports = {
	callCloud: callCloud,
	getList: getList,
	getDetail: getDetail,
	getStats: getStats,
	getSources: getSources,
	getConfig: getConfig,
	saveConfig: saveConfig,
	getCustomSources: getCustomSources,
	saveCustomSources: saveCustomSources,
	getCustomKeywords: getCustomKeywords,
	saveCustomKeywords: saveCustomKeywords,
	getSchedule: getSchedule,
	saveSchedule: saveSchedule,
	getRetention: getRetention,
	saveRetention: saveRetention,
	getDisplaySources: getDisplaySources,
	saveDisplaySources: saveDisplaySources,
	getFollowedCategories: getFollowedCategories,
	saveFollowedCategories: saveFollowedCategories,
	getBlacklistKeywords: getBlacklistKeywords,
	saveBlacklistKeywords: saveBlacklistKeywords,
	getAnalytics: getAnalytics,
	triggerCrawl: triggerCrawl
};
