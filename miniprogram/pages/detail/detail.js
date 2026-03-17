var api = require("../../utils/api");

Page({
	data: {
		item: {},
		paragraphs: [],
		attachments: [],
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
					paragraphs: data.paragraphs || [],
					attachments: data.attachments || [],
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

	onOpenAttachment: function(e) {
		var url = e.currentTarget.dataset.url;
		var name = e.currentTarget.dataset.name || "附件";
		if (!url) return;

		// PDF/DOC 等文件：先下载再用微信内置阅读器打开
		var isPdf = /\.pdf(\?.*)?$/i.test(url);
		var isDoc = /\.(doc|docx|xls|xlsx)(\?.*)?$/i.test(url);

		if (isPdf || isDoc) {
			wx.showLoading({ title: "下载中..." });
			wx.downloadFile({
				url: url,
				success: function(res) {
					wx.hideLoading();
					if (res.statusCode === 200) {
						wx.openDocument({
							filePath: res.tempFilePath,
							showMenu: true,
							fail: function() {
								wx.showToast({ title: "无法打开文件", icon: "none" });
							}
						});
					}
				},
				fail: function() {
					wx.hideLoading();
					// 下载失败降级为复制链接
					wx.setClipboardData({
						data: url,
						success: function() {
							wx.showToast({ title: "下载失败，链接已复制", icon: "none", duration: 2500 });
						}
					});
				}
			});
		} else {
			// 其他类型：复制链接
			wx.setClipboardData({
				data: url,
				success: function() {
					wx.showToast({ title: "链接已复制", icon: "success" });
				}
			});
		}
	}
});
