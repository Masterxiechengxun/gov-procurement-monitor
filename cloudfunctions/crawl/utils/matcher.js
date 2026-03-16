var keywordsConfig = require("../config/keywords");

function matchKeywords(text) {
	if (!text) {
		return { isChemical: false, matchedKeywords: [] };
	}

	var allKeywords = keywordsConfig.getAllKeywords();
	var textLower = text.toLowerCase();
	var matched = [];

	for (var i = 0; i < allKeywords.length; i++) {
		var kw = allKeywords[i];
		if (textLower.indexOf(kw.toLowerCase()) !== -1) {
			if (matched.indexOf(kw) === -1) {
				matched.push(kw);
			}
		}
	}

	return {
		isChemical: matched.length > 0,
		matchedKeywords: matched
	};
}

function matchItem(item) {
	var searchText = (item.title || "") + " " + (item.contentSnippet || "");
	var result = matchKeywords(searchText);
	item.isChemical = result.isChemical;
	item.matchedKeywords = result.matchedKeywords;
	return item;
}

module.exports = {
	matchKeywords: matchKeywords,
	matchItem: matchItem
};
