function formatDate(date) {
	if (typeof date === "string") {
		date = new Date(date);
	}
	var year = date.getFullYear();
	var month = date.getMonth() + 1;
	var day = date.getDate();
	return year + "-" + padZero(month) + "-" + padZero(day);
}

function padZero(n) {
	return n < 10 ? "0" + n : "" + n;
}

function isToday(dateStr) {
	var today = formatDate(new Date());
	return dateStr === today;
}

function daysAgo(n) {
	var date = new Date();
	date.setDate(date.getDate() - n);
	return formatDate(date);
}

function highlightKeywords(text, keywords) {
	if (!text || !keywords || keywords.length === 0) {
		return [{ text: text, highlight: false }];
	}
	var pattern = keywords.join("|");
	var regex = new RegExp("(" + pattern + ")", "gi");
	var parts = text.split(regex);
	var result = [];
	for (var i = 0; i < parts.length; i++) {
		if (parts[i] === "") {
			continue;
		}
		var isMatch = regex.test(parts[i]);
		regex.lastIndex = 0;
		result.push({
			text: parts[i],
			highlight: isMatch
		});
	}
	return result;
}

function showToast(title, icon) {
	wx.showToast({
		title: title,
		icon: icon || "none",
		duration: 2000
	});
}

module.exports = {
	formatDate: formatDate,
	padZero: padZero,
	isToday: isToday,
	daysAgo: daysAgo,
	highlightKeywords: highlightKeywords,
	showToast: showToast
};
