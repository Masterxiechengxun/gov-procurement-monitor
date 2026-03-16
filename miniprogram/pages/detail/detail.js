var api = require("../../utils/api");
var util = require("../../utils/util");
var config = require("../../utils/config");

Page({
	data: {
		detail: null,
		loading: true,
		error: "",
		id: "",
		followedCats: []
	},

	onLoad: function(options) {
		this.setData({ followedCats: config.getFollowedCategories() });
		if (options.id) {
			this.setData({ id: options.id });
			this.loadDetail(options.id);
		} else {
			this.setData({ loading: false, error: "缺少参数" });
		}
	},

	loadDetail: function(id) {
		var self = this;
		self.setData({ loading: true, error: "" });

		api.getDetail(id).then(function(data) {
			var today = util.formatDate(new Date());
			data.isNew = data.publishDate === today;

			self.setData({
				detail: data,
				loading: false
			});
		}).catch(function(err) {
			console.error("加载详情失败:", err);
			self.setData({
				loading: false,
				error: "加载失败: " + (err.message || "请重试")
			});
		});
	},

	copyLink: function() {
		var url = this.data.detail && this.data.detail.url;
		if (!url) {
			util.showToast("链接不可用");
			return;
		}

		wx.setClipboardData({
			data: url,
			success: function() {
				util.showToast("链接已复制", "success");
			},
			fail: function() {
				util.showToast("复制失败");
			}
		});
	},

	reload: function() {
		if (this.data.id) {
			this.loadDetail(this.data.id);
		}
	}
});
