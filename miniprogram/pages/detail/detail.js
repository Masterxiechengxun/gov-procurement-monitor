var api = require("../../utils/api");

Page({
	data: {
		item: {},
		htmlContent: "",
		loading: true,
		error: false,
		errorMsg: ""
	},

	onLoad: function() {
		var item = wx.getStorageSync("detail_item") || {};
		this.setData({ item: item });

		if (item.title) {
			wx.setNavigationBarTitle({ title: item.title });
		}

		if (!item.url) {
			this.setData({ loading: false, error: true, errorMsg: "暂无详情链接" });
			return;
		}

		this.fetchContent(item.url);
	},

	fetchContent: function(url) {
		var self = this;
		self.setData({ loading: true, error: false });

		api.fetchPageDetail(url)
			.then(function(data) {
				self.setData({
					htmlContent: data.html || "",
					loading: false
				});
			})
			.catch(function(err) {
				console.error("[detail] 获取详情失败:", err);
				self.setData({
					loading: false,
					error: true,
					errorMsg: "内容加载失败，请复制链接在浏览器查看"
				});
			});
	},

	onRetry: function() {
		var url = this.data.item.url;
		if (url) {
			this.fetchContent(url);
		}
	},

	onCopyUrl: function() {
		var url = this.data.item.url || "";
		if (!url) {
			wx.showToast({ title: "暂无链接", icon: "none" });
			return;
		}
		wx.setClipboardData({
			data: url,
			success: function() {
				wx.showToast({ title: "链接已复制", icon: "success" });
			}
		});
	},

});

