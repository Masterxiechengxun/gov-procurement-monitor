var api = require("../../utils/api");
var util = require("../../utils/util");
var config = require("../../utils/config");

Page({
	data: {
		pushplusToken: "",
		showToken: false,
		crawling: false,
		lastCrawl: null,

		followedCats: {},

		sources: [],
		sourcesLoaded: false,
		showAddSource: false,
		newSourceName: "",
		newSourceUrl: "",

		keywordCategories: {},
		keywordCatNames: [],
		expandedCats: {},
		keywordsLoaded: false,
		showAddCategory: false,
		newCatName: "",
		addingWordCat: "",
		newWord: "",

		schedule: {
			enabled: true,
			intervalHours: 24,
			dayType: "all",
			startHour: 6,
			startMinute: 0
		},
		scheduleLoaded: false,
		intervalOptions: [1, 2, 3, 4, 6, 8, 12, 24],
		intervalIndex: 7,
		dayTypeOptions: ["每天", "仅工作日", "仅周末"],
		dayTypeIndex: 0,
		hourOptions: [],
		minuteOptions: [],
		hourIndex: 6,
		minuteIndex: 0,

		retentionOptions: [30, 60, 90, 180, 365],
		retentionIndex: 2,
		retentionDays: 90,

		storageInfo: null
	},

	onShow: function() {
		if (typeof this.getTabBar === "function" && this.getTabBar()) {
			this.getTabBar().setData({ selected: 2 });
		}
	},

	onLoad: function() {
		var hours = [];
		for (var h = 0; h < 24; h++) {
			hours.push(h < 10 ? "0" + h : "" + h);
		}
		var minutes = [];
		for (var m = 0; m < 60; m += 5) {
			minutes.push(m < 10 ? "0" + m : "" + m);
		}
		this.setData({ hourOptions: hours, minuteOptions: minutes });

		this.loadConfig();
		this.loadSources();
		this.loadKeywords();
		this.loadSchedule();
		this.loadRetention();
		this.loadStats();
	},

	/* ========== PushPlus Token ========== */

	loadConfig: function() {
		var self = this;
		api.getConfig().then(function(config) {
			if (config && config.pushplus_token) {
				self.setData({ pushplusToken: config.pushplus_token });
			}
		}).catch(function(err) {
			console.error("加载配置失败:", err);
		});
	},

	onTokenInput: function(e) {
		this.setData({ pushplusToken: e.detail.value });
	},

	toggleShowToken: function() {
		this.setData({ showToken: !this.data.showToken });
	},

	saveToken: function() {
		var token = this.data.pushplusToken.trim();
		if (!token) {
			util.showToast("请输入Token");
			return;
		}
		wx.showLoading({ title: "保存中..." });
		api.saveConfig({ pushplus_token: token }).then(function() {
			wx.hideLoading();
			util.showToast("保存成功", "success");
		}).catch(function(err) {
			wx.hideLoading();
			util.showToast("保存失败: " + err.message);
		});
	},

	/* ========== 采购网站 ========== */

	loadSources: function() {
		var self = this;
		api.getCustomSources().then(function(data) {
			var sources = self.ensureDefaultSource(data || []);
			self.setData({ sources: sources, sourcesLoaded: true });
			self.syncDisplaySources(sources);
		}).catch(function(err) {
			console.error("加载网站列表失败:", err);
			self.setData({
				sources: [config.getDefaultSource()],
				sourcesLoaded: true
			});
			self.syncDisplaySources(self.data.sources);
		});
	},

	ensureDefaultSource: function(sources) {
		if (sources.length === 0) {
			sources.push(config.getDefaultSource());
		}
		return sources;
	},

	syncDisplaySources: function(sources) {
		if (!sources || sources.length === 0) {
			return;
		}
		var displayList = [];
		for (var i = 0; i < sources.length; i++) {
			displayList.push({ id: sources[i].id, name: sources[i].name });
		}
		config.setDisplaySources(displayList);
		api.saveDisplaySources(displayList).catch(function(err) {
			console.error("保存显示来源到云端失败:", err);
		});
	},

	deleteSource: function(e) {
		var self = this;
		var idx = e.currentTarget.dataset.idx;
		var name = self.data.sources[idx].name;

		if (self.data.sources.length <= 1) {
			util.showToast("至少保留一个网站");
			return;
		}

		wx.showModal({
			title: "删除确认",
			content: "确定删除「" + name + "」吗？",
			success: function(res) {
				if (!res.confirm) {
					return;
				}
				var list = self.data.sources.slice();
				list.splice(idx, 1);
				self.setData({ sources: list });
				self.saveSources();
			}
		});
	},

	showAddSourceForm: function() {
		this.setData({ showAddSource: true, newSourceName: "", newSourceUrl: "" });
	},

	hideAddSourceForm: function() {
		this.setData({ showAddSource: false });
	},

	onNewSourceName: function(e) {
		this.setData({ newSourceName: e.detail.value });
	},

	onNewSourceUrl: function(e) {
		this.setData({ newSourceUrl: e.detail.value });
	},

	addSource: function() {
		var name = this.data.newSourceName.trim();
		var url = this.data.newSourceUrl.trim();
		if (!name) {
			util.showToast("请输入网站名称");
			return;
		}
		if (!url) {
			util.showToast("请输入网站地址");
			return;
		}

		var id = "custom_" + Date.now();
		var list = this.data.sources.slice();
		list.push({ id: id, name: name, website: url });
		this.setData({ sources: list, showAddSource: false });
		this.saveSources();
	},

	saveSources: function() {
		var self = this;
		self.syncDisplaySources(self.data.sources);
		api.saveCustomSources(self.data.sources).then(function() {
			util.showToast("已保存", "success");
		}).catch(function(err) {
			util.showToast("保存失败");
			console.error(err);
		});
	},

	/* ========== 设备关键字 ========== */

	loadKeywords: function() {
		var self = this;
		api.getCustomKeywords().then(function(data) {
			var cats = (data && typeof data === "object") ? data : {};
			cats = self.ensureDefaultKeywords(cats);
			var names = Object.keys(cats);
			self.setData({
				keywordCategories: cats,
				keywordCatNames: names,
				keywordsLoaded: true
			});
			self.loadFollowedCats(names);
		}).catch(function(err) {
			console.error("加载设备关键字失败:", err);
			var cats = {};
			cats[config.getDefaultKeywordCategory()] = config.getDefaultKeywords();
			var names = Object.keys(cats);
			self.setData({
				keywordCategories: cats,
				keywordCatNames: names,
				keywordsLoaded: true
			});
			self.loadFollowedCats(names);
		});
	},

	loadFollowedCats: function(catNames) {
		var self = this;
		api.getFollowedCategories().then(function(data) {
			var followed = (data && Array.isArray(data) && data.length > 0) ? data : config.getFollowedCategories();
			config.setFollowedCategories(followed);
			var map = {};
			for (var i = 0; i < catNames.length; i++) {
				map[catNames[i]] = followed.indexOf(catNames[i]) !== -1;
			}
			self.setData({ followedCats: map });
		}).catch(function() {
			var followed = config.getFollowedCategories();
			var map = {};
			for (var i = 0; i < catNames.length; i++) {
				map[catNames[i]] = followed.indexOf(catNames[i]) !== -1;
			}
			self.setData({ followedCats: map });
		});
	},

	toggleCatFollow: function(e) {
		var cat = e.currentTarget.dataset.cat;
		var current = this.data.followedCats[cat];

		if (current) {
			var followed = config.getFollowedCategories();
			if (followed.length <= 1) {
				util.showToast("至少关注一个分类");
				return;
			}
		}

		var key = "followedCats." + cat;
		var newVal = !current;
		this.setData({ [key]: newVal });

		var list = [];
		var cats = this.data.followedCats;
		var names = this.data.keywordCatNames;
		for (var i = 0; i < names.length; i++) {
			if (cats[names[i]]) {
				list.push(names[i]);
			}
		}
		config.setFollowedCategories(list);
		api.saveFollowedCategories(list).catch(function(err) {
			console.error("保存关注分类到云端失败:", err);
		});
		util.showToast(newVal ? "已关注" : "已取消关注", "success");
	},

	ensureDefaultKeywords: function(cats) {
		var defaultCat = config.getDefaultKeywordCategory();
		var defaultWords = config.getDefaultKeywords();
		if (!cats[defaultCat]) {
			cats[defaultCat] = defaultWords;
		} else {
			for (var i = 0; i < defaultWords.length; i++) {
				if (cats[defaultCat].indexOf(defaultWords[i]) === -1) {
					cats[defaultCat].push(defaultWords[i]);
				}
			}
		}
		return cats;
	},

	toggleCatExpand: function(e) {
		var cat = e.currentTarget.dataset.cat;
		var key = "expandedCats." + cat;
		this.setData({ [key]: !this.data.expandedCats[cat] });
	},

	deleteKeyword: function(e) {
		var cat = e.currentTarget.dataset.cat;
		var word = e.currentTarget.dataset.word;
		var self = this;

		wx.showModal({
			title: "删除关键字",
			content: "确定从「" + cat + "」中删除「" + word + "」？",
			success: function(res) {
				if (!res.confirm) {
					return;
				}
				var cats = JSON.parse(JSON.stringify(self.data.keywordCategories));
				var list = cats[cat];
				if (!list) {
					return;
				}
				var idx = list.indexOf(word);
				if (idx !== -1) {
					list.splice(idx, 1);
				}
				if (list.length === 0) {
					delete cats[cat];
				}
				self.setData({
					keywordCategories: cats,
					keywordCatNames: Object.keys(cats)
				});
				self.saveKeywords();
			}
		});
	},

	showAddWordInput: function(e) {
		var cat = e.currentTarget.dataset.cat;
		this.setData({ addingWordCat: cat, newWord: "" });
	},

	hideAddWordInput: function() {
		this.setData({ addingWordCat: "", newWord: "" });
	},

	onNewWordInput: function(e) {
		this.setData({ newWord: e.detail.value });
	},

	addWord: function() {
		var cat = this.data.addingWordCat;
		var word = this.data.newWord.trim();
		if (!word) {
			util.showToast("请输入关键字");
			return;
		}

		var cats = JSON.parse(JSON.stringify(this.data.keywordCategories));
		if (!cats[cat]) {
			cats[cat] = [];
		}
		if (cats[cat].indexOf(word) !== -1) {
			util.showToast("关键字已存在");
			return;
		}
		cats[cat].push(word);
		this.setData({
			keywordCategories: cats,
			addingWordCat: "",
			newWord: ""
		});
		this.saveKeywords();
	},

	showAddCategoryForm: function() {
		this.setData({ showAddCategory: true, newCatName: "" });
	},

	hideAddCategoryForm: function() {
		this.setData({ showAddCategory: false });
	},

	onNewCatName: function(e) {
		this.setData({ newCatName: e.detail.value });
	},

	addCategory: function() {
		var name = this.data.newCatName.trim();
		if (!name) {
			util.showToast("请输入分类名称");
			return;
		}
		if (this.data.keywordCategories[name]) {
			util.showToast("分类已存在");
			return;
		}

		var cats = JSON.parse(JSON.stringify(this.data.keywordCategories));
		cats[name] = [];
		this.setData({
			keywordCategories: cats,
			keywordCatNames: Object.keys(cats),
			showAddCategory: false,
			addingWordCat: name,
			newWord: ""
		});
		this.saveKeywords();
	},

	deleteCategory: function(e) {
		var cat = e.currentTarget.dataset.cat;
		var self = this;

		if (self.data.keywordCatNames.length <= 1) {
			util.showToast("至少保留一个分类");
			return;
		}

		wx.showModal({
			title: "删除分类",
			content: "确定删除整个「" + cat + "」分类及其所有设备关键字？",
			success: function(res) {
				if (!res.confirm) {
					return;
				}
				var cats = JSON.parse(JSON.stringify(self.data.keywordCategories));
				delete cats[cat];
				var names = Object.keys(cats);
				self.setData({
					keywordCategories: cats,
					keywordCatNames: names
				});
				self.saveKeywords();

				if (self.data.followedCats[cat]) {
					var key = "followedCats." + cat;
					self.setData({ [key]: false });
					var list = [];
					for (var i = 0; i < names.length; i++) {
						if (self.data.followedCats[names[i]]) {
							list.push(names[i]);
						}
					}
					config.setFollowedCategories(list);
					api.saveFollowedCategories(list).catch(function(err) {
						console.error("保存关注分类到云端失败:", err);
					});
				}
			}
		});
	},

	saveKeywords: function() {
		api.saveCustomKeywords(this.data.keywordCategories).then(function() {
			util.showToast("已保存", "success");
		}).catch(function(err) {
			util.showToast("保存失败");
			console.error(err);
		});
	},

	/* ========== 抓取策略 ========== */

	loadSchedule: function() {
		var self = this;
		api.getSchedule().then(function(data) {
			if (data && typeof data === "object") {
				var intervalIdx = self.data.intervalOptions.indexOf(data.intervalHours);
				if (intervalIdx === -1) {
					intervalIdx = 7;
				}
				var dayMap = { "all": 0, "workday": 1, "weekend": 2 };
				var dayIdx = dayMap[data.dayType] || 0;
				var hIdx = data.startHour || 0;
				var mIdx = Math.floor((data.startMinute || 0) / 5);

				self.setData({
					schedule: data,
					scheduleLoaded: true,
					intervalIndex: intervalIdx,
					dayTypeIndex: dayIdx,
					hourIndex: hIdx,
					minuteIndex: mIdx
				});
			}
		}).catch(function(err) {
			console.error("加载抓取策略失败:", err);
			self.setData({ scheduleLoaded: true });
		});
	},

	toggleScheduleEnabled: function(e) {
		var val = e.detail.value;
		this.setData({ "schedule.enabled": val });
		this.saveSchedule();
	},

	onIntervalChange: function(e) {
		var idx = parseInt(e.detail.value, 10);
		var val = this.data.intervalOptions[idx];
		this.setData({
			intervalIndex: idx,
			"schedule.intervalHours": val
		});
		this.saveSchedule();
	},

	onDayTypeChange: function(e) {
		var idx = parseInt(e.detail.value, 10);
		var types = ["all", "workday", "weekend"];
		this.setData({
			dayTypeIndex: idx,
			"schedule.dayType": types[idx]
		});
		this.saveSchedule();
	},

	onStartHourChange: function(e) {
		var idx = parseInt(e.detail.value, 10);
		this.setData({
			hourIndex: idx,
			"schedule.startHour": idx
		});
		this.saveSchedule();
	},

	onStartMinuteChange: function(e) {
		var idx = parseInt(e.detail.value, 10);
		this.setData({
			minuteIndex: idx,
			"schedule.startMinute": idx * 5
		});
		this.saveSchedule();
	},

	saveSchedule: function() {
		api.saveSchedule(this.data.schedule).then(function() {
			util.showToast("策略已保存", "success");
		}).catch(function(err) {
			util.showToast("保存失败");
			console.error(err);
		});
	},

	/* ========== 数据保留期 ========== */

	loadRetention: function() {
		var self = this;
		api.getRetention().then(function(days) {
			if (typeof days === "number" && days > 0) {
				var idx = self.data.retentionOptions.indexOf(days);
				if (idx === -1) {
					idx = 2;
				}
				self.setData({
					retentionDays: days,
					retentionIndex: idx
				});
			}
		}).catch(function(err) {
			console.error("加载数据保留期失败:", err);
		});
	},

	onRetentionChange: function(e) {
		var idx = parseInt(e.detail.value, 10);
		var days = this.data.retentionOptions[idx];
		this.setData({
			retentionIndex: idx,
			retentionDays: days
		});

		api.saveRetention(days).then(function() {
			util.showToast("已保存", "success");
		}).catch(function(err) {
			util.showToast("保存失败");
			console.error(err);
		});
	},

	/* ========== 手动操作 & 统计 ========== */

	loadStats: function() {
		var self = this;
		api.getStats().then(function(data) {
			if (!data) {
				return;
			}

			if (data.lastCrawl) {
				var lc = data.lastCrawl;
				lc.durationText = lc.duration ? Math.round(lc.duration / 1000) + "秒" : "未知";
				self.setData({ lastCrawl: lc });
			}

			var sizeKB = data.estimatedSizeKB || 0;
			var sizeText;
			if (sizeKB > 1024) {
				sizeText = (sizeKB / 1024).toFixed(1) + " MB";
			} else {
				sizeText = sizeKB + " KB";
			}

			var usagePercent = Math.min(Math.round(sizeKB / (2 * 1024 * 1024) * 100 * 100) / 100, 100);
			if (usagePercent < 0.01 && sizeKB > 0) {
				usagePercent = 0.01;
			}

			self.setData({
				storageInfo: {
					total: data.total || 0,
					chemical: data.chemical || 0,
					todayNew: data.todayNew || 0,
					sizeText: sizeText,
					usagePercent: usagePercent
				}
			});
		}).catch(function(err) {
			console.error("加载统计失败:", err);
		});
	},

	manualCrawl: function() {
		var self = this;
		if (self.data.crawling) {
			return;
		}

		wx.showModal({
			title: "手动抓取",
			content: "确定要立即执行一次抓取吗？这可能需要几分钟时间。",
			success: function(res) {
				if (!res.confirm) {
					return;
				}

				self.setData({ crawling: true });
				util.showToast("开始抓取...");

				api.triggerCrawl().then(function(result) {
					self.setData({ crawling: false });
					self.loadStats();

					if (result && result.code === 0) {
						var data = result.data || {};
						var followed = config.getFollowedCategories();
						var catLabel = followed.length > 0 ? followed[0] : "关注分类";
						var msg = "新增 " + (data.newItems || 0) + " 条数据\n关键字命中 " + (data.matchedItems || 0) + " 条\n耗时 " + Math.round((data.duration || 0) / 1000) + " 秒";
						if (data.errors && data.errors.length > 0) {
							msg += "\n\n注意: " + data.errors.length + " 个错误";
						}
						wx.showModal({
							title: "抓取完成",
							content: msg,
							showCancel: false
						});
					} else {
						util.showToast("抓取失败: " + (result && result.message || "未知错误"));
					}
				}).catch(function(err) {
					self.setData({ crawling: false });
					util.showToast("抓取失败: " + err.message);
				});
			}
		});
	}
});
