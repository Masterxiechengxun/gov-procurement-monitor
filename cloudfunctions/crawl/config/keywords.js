var keywords = {
	"色谱类": [
		"色谱", "液相色谱", "气相色谱", "离子色谱",
		"高效液相", "超高效液相", "薄层色谱",
		"HPLC", "UHPLC", "GC", "IC"
	],
	"光谱类": [
		"光谱", "原子吸收", "原子荧光", "红外光谱",
		"紫外光谱", "近红外", "拉曼光谱", "荧光光谱",
		"分光光度计", "光度计", "紫外可见",
		"ICP", "ICP-OES", "ICP-MS", "AAS", "AFS"
	],
	"质谱类": [
		"质谱", "质谱仪", "色谱质谱", "气质联用", "液质联用",
		"三重四极杆", "飞行时间", "离子阱",
		"GCMS", "GC-MS", "LCMS", "LC-MS", "TOF"
	],
	"通用设备": [
		"天平", "电子天平", "分析天平", "精密天平",
		"pH计", "酸度计", "电导率仪", "溶解氧仪",
		"离心机", "高速离心", "超速离心", "冷冻离心",
		"恒温箱", "干燥箱", "培养箱", "马弗炉", "水浴锅",
		"电热板", "加热套", "恒温槽"
	],
	"前处理": [
		"移液器", "移液枪", "自动移液",
		"滴定仪", "自动滴定", "电位滴定",
		"旋转蒸发", "蒸发仪", "氮吹仪",
		"消解仪", "微波消解", "石墨消解",
		"萃取仪", "固相萃取", "液液萃取",
		"纯水机", "超纯水", "纯水仪",
		"样品前处理"
	],
	"综合类": [
		"分析仪器", "化学仪器", "实验室设备",
		"检测仪器", "实验仪器", "检验设备",
		"检测设备", "化验设备", "实验室仪器",
		"科学仪器", "精密仪器"
	],
	"高端仪器": [
		"电子显微镜", "扫描电镜", "透射电镜",
		"X射线", "X光", "XRD", "XRF",
		"DSC", "TGA", "热分析", "差示扫描",
		"元素分析", "碳氢氮", "CHN",
		"电化学工作站", "电化学"
	],
	"耗材试剂": [
		"试剂", "标准品", "标准物质",
		"色谱柱", "滤膜", "样品瓶"
	]
};

function getAllKeywords() {
	var all = [];
	var categories = Object.keys(keywords);
	for (var i = 0; i < categories.length; i++) {
		var list = keywords[categories[i]];
		for (var j = 0; j < list.length; j++) {
			if (all.indexOf(list[j]) === -1) {
				all.push(list[j]);
			}
		}
	}
	return all;
}

function getKeywordCategories() {
	return keywords;
}

module.exports = {
	keywords: keywords,
	getAllKeywords: getAllKeywords,
	getKeywordCategories: getKeywordCategories
};
