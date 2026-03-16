var STORAGE_KEY_SOURCES = "display_sources";
var STORAGE_KEY_FOLLOWED = "followed_categories";

var DEFAULT_SOURCE = {
	id: "ccgp",
	name: "中国政府采购网",
	website: "https://www.ccgp.gov.cn"
};
var DEFAULT_FOLLOWED = ["色谱类"];
var DEFAULT_KEYWORD_CATEGORY = "色谱类";
var DEFAULT_KEYWORDS = [
	"色谱", "液相色谱", "气相色谱", "离子色谱",
	"高效液相", "超高效液相", "薄层色谱",
	"HPLC", "UHPLC", "GC", "IC"
];

var config = {
	bidTypes: {
		"公开招标": "公开招标",
		"竞争性谈判": "竞争性谈判",
		"竞争性磋商": "竞争性磋商",
		"询价公告": "询价公告",
		"单一来源": "单一来源",
		"中标公告": "中标公告",
		"成交公告": "成交公告",
		"更正公告": "更正公告",
		"废标公告": "废标公告"
	},
	pageSize: 20,
	cloudEnv: "",

	getDisplaySources: function() {
		try {
			var cached = wx.getStorageSync(STORAGE_KEY_SOURCES);
			if (cached && cached.length > 0) {
				return cached;
			}
		} catch (e) {
			console.error("读取来源配置失败:", e);
		}
		return [{ id: DEFAULT_SOURCE.id, name: DEFAULT_SOURCE.name }];
	},

	setDisplaySources: function(list) {
		try {
			wx.setStorageSync(STORAGE_KEY_SOURCES, list);
		} catch (e) {
			console.error("保存来源配置失败:", e);
		}
	},

	getFollowedCategories: function() {
		try {
			var cached = wx.getStorageSync(STORAGE_KEY_FOLLOWED);
			if (cached && cached.length > 0) {
				return cached;
			}
		} catch (e) {
			console.error("读取关注分类失败:", e);
		}
		return DEFAULT_FOLLOWED.slice();
	},

	setFollowedCategories: function(list) {
		try {
			wx.setStorageSync(STORAGE_KEY_FOLLOWED, list);
		} catch (e) {
			console.error("保存关注分类失败:", e);
		}
	},

	getDefaultSource: function() {
		return JSON.parse(JSON.stringify(DEFAULT_SOURCE));
	},

	getDefaultSourceId: function() {
		return DEFAULT_SOURCE.id;
	},

	getDefaultKeywordCategory: function() {
		return DEFAULT_KEYWORD_CATEGORY;
	},

	getDefaultKeywords: function() {
		return DEFAULT_KEYWORDS.slice();
	}
};

module.exports = config;
