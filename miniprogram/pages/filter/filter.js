var api = require("../../utils/api");
var util = require("../../utils/util");
var config = require("../../utils/config");

Page({
	data: {
		sourceList: [],
		followedCats: [],
		keywordCategories: {},
		selectedCategory: "",
		dateOptions: [
			{ value: "all", label: "全部" },
			{ value: "today", label: "今天" },
			{ value: "3days", label: "近3天" },
			{ value: "7days", label: "近7天" },
			{ value: "30days", label: "近30天" },
			{ value: "custom", label: "自定义" }
		],
		selectedSource: "",
		selectedDateOption: "all",
		dateFrom: "",
		dateTo: "",
		keyword: "",
		_filterResult: null
	},

	onLoad: function() {
		var cats = config.getFollowedCategories();
		this.setData({
			sourceList: config.getDisplaySources(),
			followedCats: cats
		});
		this.loadKeywords();
		this.syncFromIndexPage();
	},

	// 从首页同步当前筛选状态，实现筛选表单与首页联动
	syncFromIndexPage: function() {
		var pages = getCurrentPages();
		if (pages.length < 2) return;
		var indexPage = pages[pages.length - 2];
		if (!indexPage || indexPage.route !== "pages/index/index") return;

		var idx = indexPage.data;
		var selectedSource = idx.currentSource || "";
		var fp = idx.filterParams || {};
		var keyword = fp.keyword || "";
		var dateFrom = fp.dateFrom || "";
		var dateTo = fp.dateTo || "";
		var selectedDateOption = "all";
		var today = util.formatDate(new Date());

		// 根据 currentTab 判断日期
		if (idx.currentTab === "today") {
			selectedDateOption = "today";
			dateFrom = today;
			dateTo = today;
		} else if (dateFrom && dateTo) {
			if (dateFrom === today && dateTo === today) {
				selectedDateOption = "today";
			} else if (dateFrom === util.daysAgo(3)) {
				selectedDateOption = "3days";
			} else if (dateFrom === util.daysAgo(7)) {
				selectedDateOption = "7days";
			} else if (dateFrom === util.daysAgo(30)) {
				selectedDateOption = "30days";
			} else {
				selectedDateOption = "custom";
			}
		}

		// 根据 currentTab 还原分类单选（与首页 Tab 一致）
		var selectedCategory = "";
		var tab = idx.currentTab;
		if (tab && tab.indexOf("cat:") === 0) {
			selectedCategory = tab.substring(4);
		}

		this.setData({
			selectedSource: selectedSource,
			selectedDateOption: selectedDateOption,
			dateFrom: dateFrom,
			dateTo: dateTo,
			keyword: keyword,
			selectedCategory: selectedCategory
		});
	},

	loadKeywords: function() {
		var self = this;
		api.getCustomKeywords().then(function(data) {
			if (data && typeof data === "object") {
				self.setData({ keywordCategories: data });
			}
		}).catch(function() {});
	},

	onSelectSource: function(e) {
		this.setData({ selectedSource: e.currentTarget.dataset.source });
	},

	onSelectDateOption: function(e) {
		var value = e.currentTarget.dataset.value;
		this.setData({ selectedDateOption: value });

		if (value === "custom") {
			// 自定义日期由用户后续选择，此处不预设
			return;
		}
		var dates = this.calcDateRange(value);
		this.setData({
			dateFrom: dates.from,
			dateTo: dates.to
		});
	},

	onDateFromChange: function(e) {
		this.setData({ dateFrom: e.detail.value });
	},

	onDateToChange: function(e) {
		this.setData({ dateTo: e.detail.value });
	},

	onSelectCategory: function(e) {
		this.setData({ selectedCategory: e.currentTarget.dataset.cat });
	},

	onKeywordInput: function(e) {
		this.setData({ keyword: e.detail.value });
	},

	clearKeyword: function() {
		this.setData({ keyword: "" });
	},

	calcDateRange: function(option) {
		var today = util.formatDate(new Date());
		var from = "";
		var to = today;

		if (option === "all") {
			// 「全部」不限制日期，传空字符串
			return { from: "", to: "" };
		}
		if (option === "today") {
			from = today;
		} else if (option === "3days") {
			from = util.daysAgo(3);
		} else if (option === "7days") {
			from = util.daysAgo(7);
		} else if (option === "30days") {
			from = util.daysAgo(30);
		}

		return { from: from, to: to };
	},

	onReset: function() {
		this.setData({
			selectedSource: "",
			selectedDateOption: "all",
			dateFrom: "",
			dateTo: "",
			selectedCategory: "",
			keyword: ""
		});
	},

	onApply: function() {
		var pages = getCurrentPages();
		var selectedCategory = this.data.selectedCategory || "";
		// 单选分类：通过 currentTab 与首页 Tab 联动，无需 matchKeywords
		var currentTab = selectedCategory ? "cat:" + selectedCategory : "all";

		// 「全部」或「自定义」未选完日期时，不传日期限制
		var dateFrom = this.data.dateFrom || "";
		var dateTo = this.data.dateTo || "";
		if (this.data.selectedDateOption === "all" || (this.data.selectedDateOption === "custom" && (!dateFrom || !dateTo))) {
			dateFrom = "";
			dateTo = "";
		}

		var params = {
			source: this.data.selectedSource || "",
			selectedCategories: selectedCategory ? [selectedCategory] : [],
			matchKeywords: [],
			chemicalOnly: false,
			keyword: (this.data.keyword || "").trim(),
			dateFrom: dateFrom,
			dateTo: dateTo
		};

		if (pages.length >= 2) {
			var indexPage = pages[pages.length - 2];
			indexPage.setData({
				_filterResult: params,
				currentSource: params.source || "",
				filterParams: params,
				currentTab: currentTab
			}, function() {
				indexPage.loadList(true);
			});
		}

		wx.navigateBack();
	}
});
