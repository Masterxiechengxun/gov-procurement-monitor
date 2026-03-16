var keywords = {
	"耗材": ["耗材"]
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
