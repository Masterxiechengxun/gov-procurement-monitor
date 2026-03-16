var api = require("../../utils/api");
var util = require("../../utils/util");
var config = require("../../utils/config");

Page({
	data: {
		sourceList: [],
		followedCats: [],
		keywordCategories: {},
		selectedCats: {},
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
		var selected = {};
		for (var i = 0; i < cats.length; i++) {
			selected[cats[i]] = false;
		}
		this.setData({
			sourceList: config.getDisplaySources(),
			followedCats: cats,
			selectedCats: selected
		});
		this.loadKeywords();
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

		if (value !== "custom") {
			var dates = this.calcDateRange(value);
			this.setData({
				dateFrom: dates.from,
				dateTo: dates.to
			});
		}
	},

	onDateFromChange: function(e) {
		this.setData({ dateFrom: e.detail.value });
	},

	onDateToChange: function(e) {
		this.setData({ dateTo: e.detail.value });
	},

	onCatToggle: function(e) {
		var cat = e.currentTarget.dataset.cat;
		var key = "selectedCats." + cat;
		this.setData({ [key]: e.detail.value });
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
		var cats = this.data.followedCats;
		var selected = {};
		for (var i = 0; i < cats.length; i++) {
			selected[cats[i]] = false;
		}
		this.setData({
			selectedSource: "",
			selectedDateOption: "all",
			dateFrom: "",
			dateTo: "",
			selectedCats: selected,
			keyword: ""
		});
	},

	onApply: function() {
		var selectedCategories = [];
		var cats = this.data.followedCats;
		var sel = this.data.selectedCats;
		var kwCfg = this.data.keywordCategories;
		for (var i = 0; i < cats.length; i++) {
			if (sel[cats[i]]) {
				selectedCategories.push(cats[i]);
			}
		}

		var matchKeywords = [];
		for (var j = 0; j < selectedCategories.length; j++) {
			var words = kwCfg[selectedCategories[j]];
			if (words && words.length > 0) {
				for (var k = 0; k < words.length; k++) {
					if (matchKeywords.indexOf(words[k]) === -1) {
						matchKeywords.push(words[k]);
					}
				}
			}
		}

		var params = {
			source: this.data.selectedSource,
			selectedCategories: selectedCategories,
			matchKeywords: matchKeywords,
			chemicalOnly: false,
			keyword: this.data.keyword,
			dateFrom: this.data.dateFrom,
			dateTo: this.data.dateTo
		};

		var pages = getCurrentPages();
		if (pages.length >= 2) {
			var indexPage = pages[pages.length - 2];
			indexPage.setData({
				_filterResult: params,
				currentSource: params.source,
				filterParams: params,
				currentTab: "all"
			});
			indexPage.loadList(true);
		}

		wx.navigateBack();
	}
});
