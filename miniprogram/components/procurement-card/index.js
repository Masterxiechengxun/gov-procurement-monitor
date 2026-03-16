var util = require("../../utils/util");

Component({
	properties: {
		item: {
			type: Object,
			value: {}
		},
		followedCats: {
			type: Array,
			value: []
		}
	},

	data: {
		titleParts: [],
		primaryCat: "",
		primaryCatColorIndex: 0
	},

	observers: {
		"item, followedCats": function(item, followedCats) {
			if (!item || !item.title) {
				return;
			}
			followedCats = followedCats || [];
			var keywords = item.matchedKeywords || [];
			var parts = util.highlightKeywords(item.title, keywords);
			// 主类别：优先取第一个在 followedCats 中的匹配关键词，否则取第一个匹配词
			var primaryCat = "";
			var colorIndex = 0;
			if (keywords.length > 0 && Array.isArray(followedCats) && followedCats.length > 0) {
				for (var i = 0; i < keywords.length; i++) {
					var idx = followedCats.indexOf(keywords[i]);
					if (idx >= 0) {
						primaryCat = keywords[i];
						colorIndex = idx;
						break;
					}
				}
				if (!primaryCat) {
					primaryCat = keywords[0];
					colorIndex = followedCats.indexOf(primaryCat);
					if (colorIndex < 0) colorIndex = 0;
				}
			} else if (keywords.length > 0) {
				primaryCat = keywords[0];
			}
			this.setData({
				titleParts: parts,
				primaryCat: primaryCat,
				primaryCatColorIndex: colorIndex % 8
			});
		}
	},

	methods: {
		onTap: function() {
			this.triggerEvent("cardtap", { item: this.properties.item });
		}
	}
});
