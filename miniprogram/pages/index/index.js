var api = require("../../utils/api");
var util = require("../../utils/util");
var config = require("../../utils/config");

Page({
	data: {
		list: [],
		loading: false,
		showSkeleton: true,
		noMore: false,
		page: 1,
		pageSize: 20,
		currentTab: "all",
		currentSource: "",
		stats: {
			total: 0,
			todayNew: 0,
			catCounts: []
		},
		sourceList: [],
		followedCats: [],
		keywordCategories: {},
		filterParams: {}
	},

	onLoad: function() {
		this.setData({
			sourceList: config.getDisplaySources(),
			followedCats: config.getFollowedCategories()
		});
		this.loadStats();
		this.loadList(true);
		this.syncCloudPrefs();
		this.loadKeywords();
	},

	onShow: function() {
		if (typeof this.getTabBar === "function" && this.getTabBar()) {
			this.getTabBar().setData({ selected: 0 });
		}
		var prevCats = this.data.followedCats;
		var newCats = config.getFollowedCategories();
		this.setData({
			sourceList: config.getDisplaySources(),
			followedCats: newCats
		});
		if (prevCats.join(",") !== newCats.join(",")) {
			this.loadStats();
		}
	},

	syncCloudPrefs: function() {
		var self = this;
		// 从云端同步用户启用的来源列表，驱动首页来源快捷栏
		api.getCustomSources().then(function(data) {
			if (data && Array.isArray(data) && data.length > 0) {
				config.setDisplaySources(data);
				self.setData({ sourceList: data });
			}
		}).catch(function() {});
		// 从云端同步关注分类（与关键字列表保持一致）
		api.getFollowedCategories().then(function(data) {
			if (data && Array.isArray(data) && data.length > 0) {
				config.setFollowedCategories(data);
				self.setData({ followedCats: data });
				self.loadStats();
			}
		}).catch(function() {});
	},

	loadKeywords: function() {
		var self = this;
		api.getCustomKeywords().then(function(data) {
			if (data && typeof data === "object") {
				self.setData({ keywordCategories: data });
			}
		}).catch(function() {});
	},

	onPullDownRefresh: function() {
		var self = this;
		self.loadStats();
		self.loadList(true).then(function() {
			wx.stopPullDownRefresh();
		}).catch(function() {
			wx.stopPullDownRefresh();
		});
	},

	onReachBottom: function() {
		if (!this.data.loading && !this.data.noMore) {
			this.loadList(false);
		}
	},

	loadStats: function() {
		var self = this;
		var catColors = [
			"stat-card-danger", "stat-card-success",
			"stat-card-info", "stat-card-purple",
			"stat-card-orange", "stat-card-accent"
		];
		api.getStats().then(function(data) {
			var cats = self.data.followedCats;
			var serverCatCounts = data.catCounts || {};
			var catCounts = [];
			for (var i = 0; i < cats.length; i++) {
				catCounts.push({
					name: cats[i],
					count: serverCatCounts[cats[i]] || 0,
					colorClass: catColors[i % catColors.length]
				});
			}
			self.setData({
				stats: {
					total: data.total || 0,
					todayNew: data.todayNew || 0,
					catCounts: catCounts
				}
			});
		}).catch(function(err) {
			console.error("loadStats error:", err);
		});
	},

	loadList: function(refresh) {
		var self = this;
		if (self.data.loading) {
			return Promise.resolve();
		}

		var page = refresh ? 1 : self.data.page + 1;
		self.setData({ loading: true });

		if (refresh) {
			self.setData({ list: [], noMore: false, page: 1, showSkeleton: true });
		}

		var tab = self.data.currentTab;
		var fp = self.data.filterParams;
		var params = {
			page: page,
			pageSize: self.data.pageSize,
			source: self.data.currentSource,
			chemicalOnly: false,
			keyword: fp.keyword || ""
		};

		if (fp.matchKeywords && fp.matchKeywords.length > 0) {
			params.matchKeywords = fp.matchKeywords;
		}

		if (tab.indexOf("cat:") === 0) {
			var catName = tab.substring(4);
			var catWords = self.data.keywordCategories[catName];
			if (catWords && catWords.length > 0) {
				params.matchKeywords = catWords;
			} else {
				params.chemicalOnly = true;
			}
		}

		if (tab === "today") {
			params.dateFrom = util.formatDate(new Date());
			params.dateTo = util.formatDate(new Date());
		} else if (fp.dateFrom) {
			params.dateFrom = fp.dateFrom;
			params.dateTo = fp.dateTo || "";
		}

		return api.getList(params).then(function(data) {
			var newList = data.list || [];
			var currentList = refresh ? [] : self.data.list.slice();

			for (var i = 0; i < newList.length; i++) {
				currentList.push(newList[i]);
			}

			self.setData({
				list: currentList,
				page: page,
				loading: false,
				showSkeleton: false,
				noMore: newList.length < self.data.pageSize
			});
		}).catch(function(err) {
			console.error("loadList error:", err);
			self.setData({ loading: false, showSkeleton: false });
			util.showToast("加载失败，请重试");
		});
	},

	onTabChange: function(e) {
		var tab = e.currentTarget.dataset.tab;
		if (tab === this.data.currentTab) {
			return;
		}
		this.setData({ currentTab: tab, filterParams: {} });
		this.loadList(true);
	},

	// 点击顶部统计卡片时切换筛选条件
	onStatCardTap: function(e) {
		var tab = e.currentTarget.dataset.tab;
		if (tab === this.data.currentTab) {
			return;
		}
		this.setData({ currentTab: tab, filterParams: {} });
		this.loadList(true);
	},

	onSourceChange: function(e) {
		var source = e.currentTarget.dataset.source;
		if (source === this.data.currentSource) {
			return;
		}
		this.setData({ currentSource: source });
		this.loadList(true);
	},

	goToFilter: function() {
		wx.navigateTo({ url: "/pages/filter/filter" });
	},

	onCardTap: function(e) {
		var item = e.detail.item;
		wx.navigateTo({
			url: "/pages/detail/detail?url=" + encodeURIComponent(item.url || "") +
				 "&title=" + encodeURIComponent(item.title || "招标详情")
		});
	}
});
