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
		titleParts: []
	},

	observers: {
		"item": function(item) {
			if (!item || !item.title) {
				return;
			}
			var keywords = item.matchedKeywords || [];
			var parts = util.highlightKeywords(item.title, keywords);
			this.setData({ titleParts: parts });
		}
	},

	methods: {
		onTap: function() {
			this.triggerEvent("cardtap", { item: this.properties.item });
		}
	}
});
