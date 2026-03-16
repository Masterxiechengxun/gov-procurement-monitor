var api = require("../../utils/api");
var config = require("../../utils/config");

// 与 config.getCategoryColorKey 对应的颜色索引，用于统计页样式
var CAT_COLOR_INDEX_MAX = 8;

Page({
		data: {
			loading: true,
			isEmpty: false,
			followedCats: [],
			legendItems: [],
		overview: {
			total: 0,
			chemical: 0,
			todayNew: 0
		},
		dailyTrend: [],
		catRatios: [],
		sourceDistribution: [],
		topKeywords: [],
		bidTypes: []
	},

	onLoad: function() {
		var cats = config.getFollowedCategories();
		this.setData({
			followedCats: cats,
			legendItems: this.getLegendItems(cats)
		});
		this.loadAnalytics();
		this.syncCloudFollowed();
	},

	onShow: function() {
		if (typeof this.getTabBar === "function" && this.getTabBar()) {
			this.getTabBar().setData({ selected: 1 });
		}
		var cats = config.getFollowedCategories();
		this.setData({
			followedCats: cats,
			legendItems: this.getLegendItems(cats)
		});
	},

	syncCloudFollowed: function() {
		var self = this;
		api.getFollowedCategories().then(function(data) {
			if (data && Array.isArray(data) && data.length > 0) {
				config.setFollowedCategories(data);
				self.setData({
					followedCats: data,
					legendItems: self.getLegendItems(data)
				});
			}
		}).catch(function() {});
	},

	onPullDownRefresh: function() {
		var self = this;
		self.loadAnalytics().then(function() {
			wx.stopPullDownRefresh();
		}).catch(function() {
			wx.stopPullDownRefresh();
		});
	},

	loadAnalytics: function() {
		var self = this;
		self.setData({ loading: true });

		return api.getAnalytics().then(function(data) {
			if (!data) {
				self.setData({ loading: false, isEmpty: true });
				return;
			}

			var catRatios = self.processCatRatios(data.overview);
			self.setData({
				loading: false,
				isEmpty: data.overview.total === 0,
				overview: data.overview || self.data.overview,
				dailyTrend: self.processTrend(data.dailyTrend || []),
				catRatios: catRatios,
				legendItems: self.getLegendItems(self.data.followedCats),
				sourceDistribution: self.processHBars(data.sourceDistribution || [], "count"),
				topKeywords: self.processHBars(data.topKeywords || [], "count"),
				bidTypes: self.processHBars(data.bidTypes || [], "count")
			});
		}).catch(function(err) {
			console.error("loadAnalytics error:", err);
			self.setData({ loading: false, isEmpty: true });
		});
	},

	processTrend: function(trend) {
		if (!trend || trend.length === 0) {
			return [];
		}
		var maxCount = 1;
		for (var i = 0; i < trend.length; i++) {
			if (trend[i].count > maxCount) {
				maxCount = trend[i].count;
			}
		}
		var result = [];
		for (var j = 0; j < trend.length; j++) {
			var item = trend[j];
			var heightPct = Math.max(Math.round(item.count / maxCount * 100), 3);
			var chemPct = 0;
			if (item.count > 0 && item.chemCount > 0) {
				chemPct = Math.round(item.chemCount / item.count * 100);
			}
			var dateStr = item.date || "";
			var label = dateStr.length >= 10 ? dateStr.substring(5) : dateStr;
			result.push({
				date: item.date,
				count: item.count,
				chemCount: item.chemCount || 0,
				heightPct: heightPct,
				chemPct: chemPct,
				label: label
			});
		}
		return result;
	},

	processCatRatios: function(overview) {
		if (!overview) {
			return [];
		}
		var total = overview.total || 0;
		var cats = this.data.followedCats;
		var catCounts = overview.catCounts || {};
		var ratios = [];
		for (var i = 0; i < cats.length; i++) {
			var catName = cats[i];
			var count = catCounts[catName] || 0;
			var percent = total > 0 ? Math.round(count / total * 100) : 0;
			ratios.push({
				name: catName,
				percent: percent,
				count: count,
				total: total,
				colorIndex: i % CAT_COLOR_INDEX_MAX
			});
		}
		return ratios;
	},

	// 为 7 天趋势图例生成带颜色索引的列表
	getLegendItems: function(cats) {
		cats = cats || this.data.followedCats || [];
		return cats.map(function(name, i) {
			return { name: name, colorIndex: i % CAT_COLOR_INDEX_MAX };
		});
	},

	processHBars: function(items, field) {
		if (!items || items.length === 0) {
			return [];
		}
		var maxVal = 1;
		for (var i = 0; i < items.length; i++) {
			if (items[i][field] > maxVal) {
				maxVal = items[i][field];
			}
		}
		for (var j = 0; j < items.length; j++) {
			items[j].widthPct = Math.max(Math.round(items[j][field] / maxVal * 100), 5);
		}
		return items;
	}
});
