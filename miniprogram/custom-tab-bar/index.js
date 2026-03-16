Component({
	data: {
		selected: 0,
		list: [
			{
				pagePath: "/pages/index/index",
				text: "采购信息",
				icon: "/images/tab-cart.svg",
				activeIcon: "/images/tab-cart-active.svg"
			},
			{
				pagePath: "/pages/stats/stats",
				text: "数据统计",
				icon: "/images/tab-chart.svg",
				activeIcon: "/images/tab-chart-active.svg"
			},
			{
				pagePath: "/pages/settings/settings",
				text: "我的设置",
				icon: "/images/tab-gear.svg",
				activeIcon: "/images/tab-gear-active.svg"
			}
		]
	},

	methods: {
		switchTab: function(e) {
			var idx = parseInt(e.currentTarget.dataset.index, 10);
			var item = this.data.list[idx];
			if (idx === this.data.selected) {
				return;
			}
			wx.switchTab({ url: item.pagePath });
		}
	}
});
