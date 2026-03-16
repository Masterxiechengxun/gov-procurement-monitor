var sources = [
	{
		id: "ccgp",
		name: "中国政府采购网",
		baseUrl: "http://search.ccgp.gov.cn/bxsearch",
		website: "https://www.ccgp.gov.cn",
		description: "全国政府采购信息发布指定媒体，覆盖全国各省市",
		params: {
			searchtype: "1",
			bidSort: "0",
			pinMu: "1",
			dbselect: "bidx",
			pppStatus: "0",
			zoneId: "51",
			displayZone: "四川省"
		},
		bidTypes: [
			{ value: "1", label: "公开招标" },
			{ value: "2", label: "询价公告" },
			{ value: "3", label: "竞争性谈判" },
			{ value: "4", label: "单一来源" },
			{ value: "5", label: "竞争性磋商" },
			{ value: "7", label: "中标公告" },
			{ value: "8", label: "成交公告" },
			{ value: "11", label: "更正公告" },
			{ value: "12", label: "废标公告" }
		]
	},
	{
		id: "sichuan_ggzy",
		name: "四川省公共资源交易网",
		baseUrl: "https://ggzyjy.sc.gov.cn",
		website: "https://ggzyjy.sc.gov.cn",
		description: "四川省政府政务服务和公共资源交易服务中心，覆盖省/市/县三级",
		categories: ["002002001", "002002003"]
	}
];

function getEnabledSources() {
	return sources.slice();
}

function getSourceById(id) {
	for (var i = 0; i < sources.length; i++) {
		if (sources[i].id === id) {
			return sources[i];
		}
	}
	return null;
}

module.exports = {
	sources: sources,
	getEnabledSources: getEnabledSources,
	getSourceById: getSourceById
};
