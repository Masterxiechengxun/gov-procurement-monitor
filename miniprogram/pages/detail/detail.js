Page({
	data: {
		url: "",
		title: "",
		statusBarHeight: 0,
		navHeight: 0,
		error: ""
	},

	onLoad: function(options) {
		var info = wx.getSystemInfoSync();
		var statusBarHeight = info.statusBarHeight || 0;
		var navHeight = statusBarHeight + 44;
		var url = options.url ? decodeURIComponent(options.url) : "";
		var title = options.title ? decodeURIComponent(options.title) : "招标详情";
		this.setData({
			url: url,
			title: title,
			statusBarHeight: statusBarHeight,
			navHeight: navHeight,
			error: url ? "" : "缺少页面地址"
		});
	},

	goBack: function() {
		wx.navigateBack();
	},

	openInBrowser: function() {
		var url = this.data.url;
		if (!url) return;
		wx.setClipboardData({
			data: url,
			success: function() {
				wx.showToast({
					title: "链接已复制，请在浏览器粘贴打开",
					icon: "none",
					duration: 3000
				});
			}
		});
	}
});
