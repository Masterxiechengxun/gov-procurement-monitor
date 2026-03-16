var api = require("../../utils/api");
var util = require("../../utils/util");
var config = require("../../utils/config");

Page({
	// 内置来源列表（与 cloudfunctions/crawl/config/sources.js 保持一致）
	_builtInSources: [
		{
			id: "ccgp",
			name: "中国政府采购网",
			website: "https://www.ccgp.gov.cn",
			desc: "全国政府采购信息发布指定媒体，覆盖全国各省市",
			enabled: true
		},
		{
			id: "sichuan_ggzy",
			name: "四川省公共资源交易网",
			website: "https://ggzyjy.sc.gov.cn",
			desc: "四川省政府政务服务和公共资源交易服务中心",
			enabled: true
		}
	],

	data: {
		pushplusToken: "",
		showToken: false,
		crawling: false,
		lastCrawl: null,

		sources: [],
		sourcesLoaded: false,

		keywords: [],
		keywordsLoaded: false,
		addingWord: false,
		newWord: "",

		schedule: {
			enabled: true,
			dayType: "all"
		},
		scheduleLoaded: false,
		dayTypeOptions: ["每天", "仅工作日", "仅周末"],
		dayTypeIndex: 0,

		storageInfo: null
	},

	onShow: function() {
		if (typeof this.getTabBar === "function" && this.getTabBar()) {
			this.getTabBar().setData({ selected: 2 });
		}
	},

	onLoad: function() {
		this.loadConfig();
		this.loadSources();
		this.loadKeywords();
		this.loadSchedule();
		this.loadStats();
	},

	/* ========== PushPlus Token ========== */

	loadConfig: function() {
		var self = this;
		api.getConfig().then(function(cfg) {
			if (cfg && cfg.pushplus_token) {
				self.setData({ pushplusToken: cfg.pushplus_token });
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
		var builtIn = self._builtInSources;
		api.getCustomSources().then(function(saved) {
			var sources = builtIn.map(function(src) {
				var s = JSON.parse(JSON.stringify(src));
				if (saved && Array.isArray(saved) && saved.length > 0) {
					// 有用户配置时，以 DB 中存在与否决定启用状态
					s.enabled = saved.some(function(x) { return x.id === s.id; });
				}
				return s;
			});
			self.setData({ sources: sources, sourcesLoaded: true });
		}).catch(function() {
			var sources = builtIn.map(function(src) {
				return JSON.parse(JSON.stringify(src));
			});
			self.setData({ sources: sources, sourcesLoaded: true });
		});
	},

	toggleSource: function(e) {
		var idx = e.currentTarget.dataset.idx;
		var sources = JSON.parse(JSON.stringify(this.data.sources));
		var newEnabled = !sources[idx].enabled;

		if (!newEnabled) {
			var enabledCount = sources.filter(function(s) { return s.enabled; }).length;
			if (enabledCount <= 1) {
				util.showToast("至少启用一个数据来源");
				return;
			}
		}

		sources[idx].enabled = newEnabled;
		this.setData({ sources: sources });
		this.saveSources(sources);
	},

	saveSources: function(sources) {
		// 只将启用的来源写入云端，crawl 云函数据此决定抓取范围
		var enabled = sources
			.filter(function(s) { return s.enabled; })
			.map(function(s) { return { id: s.id, name: s.name }; });

		// 同步本地缓存，让首页来源快捷栏立即反映变化
		config.setDisplaySources(enabled);

		api.saveCustomSources(enabled).then(function() {
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
			var keys = Object.keys(cats);

			// 检测是否为旧的分层格式（每个 key 的 value 应只含自身一个词）
			// 旧格式示例：{"色谱类": ["色谱", "液相色谱", ...]}
			// 新格式示例：{"耗材": ["耗材"]}
			var isOldFormat = false;
			for (var i = 0; i < keys.length; i++) {
				var words = cats[keys[i]];
				if (!Array.isArray(words) || words.length !== 1 || words[0] !== keys[i]) {
					isOldFormat = true;
					break;
				}
			}

			var keywords;
			if (keys.length === 0 || isOldFormat) {
				// 无数据或旧格式，重置为默认并静默写入云端
				keywords = config.getDefaultKeywords();
				var resetCats = {};
				for (var j = 0; j < keywords.length; j++) {
					resetCats[keywords[j]] = [keywords[j]];
				}
				api.saveCustomKeywords(resetCats).catch(function() {});
				api.saveFollowedCategories(keywords).catch(function() {});
			} else {
				keywords = keys;
			}

			self._applyKeywords(keywords);
		}).catch(function(err) {
			console.error("加载设备关键字失败:", err);
			self._applyKeywords(config.getDefaultKeywords());
		});
	},

	// 将关键字列表应用到本地状态，并同步 followedCats
	_applyKeywords: function(keywords) {
		config.setFollowedCategories(keywords);
		this.setData({ keywords: keywords, keywordsLoaded: true });
	},

	showAddWordInput: function() {
		this.setData({ addingWord: true, newWord: "" });
	},

	hideAddWordInput: function() {
		this.setData({ addingWord: false, newWord: "" });
	},

	onNewWordInput: function(e) {
		this.setData({ newWord: e.detail.value });
	},

	addWord: function() {
		var word = this.data.newWord.trim();
		if (!word) {
			util.showToast("请输入关键字");
			return;
		}
		if (this.data.keywords.indexOf(word) !== -1) {
			util.showToast("关键字已存在");
			return;
		}
		var keywords = this.data.keywords.slice();
		keywords.push(word);
		this.setData({ addingWord: false, newWord: "" });
		this.saveKeywords(keywords);
	},

	deleteWord: function(e) {
		var word = e.currentTarget.dataset.word;
		var self = this;
		if (self.data.keywords.length <= 1) {
			util.showToast("至少保留一个关键字");
			return;
		}
		wx.showModal({
			title: "删除关键字",
			content: "确定删除「" + word + "」？",
			success: function(res) {
				if (!res.confirm) {
					return;
				}
				var keywords = self.data.keywords.slice();
				var idx = keywords.indexOf(word);
				if (idx !== -1) {
					keywords.splice(idx, 1);
				}
				self.saveKeywords(keywords);
			}
		});
	},

	saveKeywords: function(keywords) {
		var self = this;
		// 每个关键字是自己的类别：{word: [word]}
		var cats = {};
		for (var i = 0; i < keywords.length; i++) {
			cats[keywords[i]] = [keywords[i]];
		}
		self._applyKeywords(keywords);
		api.saveFollowedCategories(keywords).catch(function(err) {
			console.error("保存关注分类失败:", err);
		});
		api.saveCustomKeywords(cats).then(function() {
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
				var dayMap = { "all": 0, "workday": 1, "weekend": 2 };
				var dayIdx = (dayMap[data.dayType] !== undefined) ? dayMap[data.dayType] : 0;
				self.setData({
					schedule: data,
					scheduleLoaded: true,
					dayTypeIndex: dayIdx
				});
			} else {
				self.setData({ scheduleLoaded: true });
			}
		}).catch(function(err) {
			console.error("加载抓取策略失败:", err);
			self.setData({ scheduleLoaded: true });
		});
	},

	toggleScheduleEnabled: function(e) {
		this.setData({ "schedule.enabled": e.detail.value });
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

	saveSchedule: function() {
		api.saveSchedule(this.data.schedule).then(function() {
			util.showToast("策略已保存", "success");
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
