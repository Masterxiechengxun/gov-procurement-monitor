var axios = require("axios");

var PUSHPLUS_API = "http://www.pushplus.plus/send";

function buildHtmlMessage(items) {
	var lines = [];
	lines.push("<h3>今日新增 " + items.length + " 条设备采购信息</h3>");
	lines.push("<p style=\"color:#666;font-size:12px;\">推送时间: " + new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) + "</p>");
	lines.push("<hr/>");

	for (var i = 0; i < items.length; i++) {
		var item = items[i];
		var idx = i + 1;
		lines.push("<div style=\"margin-bottom:15px;\">");
		lines.push("<p><b>" + idx + ". " + escapeHtml(item.title) + "</b></p>");
		lines.push("<p style=\"color:#666;font-size:12px;\">");
		lines.push("来源: " + escapeHtml(item.sourceName));
		if (item.publishDate) {
			lines.push(" | 日期: " + item.publishDate);
		}
		lines.push("</p>");

		if (item.buyer || item.region) {
			lines.push("<p style=\"color:#666;font-size:12px;\">");
			if (item.buyer) {
				lines.push("采购人: " + escapeHtml(item.buyer));
			}
			if (item.region) {
				lines.push(" | 地区: " + escapeHtml(item.region));
			}
			lines.push("</p>");
		}

		if (item.matchedKeywords && item.matchedKeywords.length > 0) {
			lines.push("<p style=\"color:#FF3B30;font-size:12px;\">");
			lines.push("匹配设备关键字: " + item.matchedKeywords.join(", "));
			lines.push("</p>");
		}

		if (item.url) {
			lines.push("<p><a href=\"" + escapeHtml(item.url) + "\" style=\"color:#2B5CE6;\">点击查看原文 →</a></p>");
		}
		lines.push("</div>");
		lines.push("<hr/>");
	}

	lines.push("<p style=\"color:#999;font-size:11px;\">由采购信息监控系统自动推送</p>");
	return lines.join("\n");
}

function buildErrorMessage(sourceDetails, errors, stats) {
	var lines = [];
	lines.push("<h3 style=\"color:#FF3B30;\">抓取异常报告</h3>");
	lines.push("<p style=\"color:#666;font-size:12px;\">时间: " + new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) + "</p>");
	lines.push("<hr/>");

	if (sourceDetails && sourceDetails.length > 0) {
		lines.push("<h4>各网站状态:</h4>");
		for (var i = 0; i < sourceDetails.length; i++) {
			var sd = sourceDetails[i];
			var icon = sd.status === "success" ? "✅" : (sd.status === "partial" ? "⚠️" : "❌");
			lines.push("<p>" + icon + " <b>" + escapeHtml(sd.sourceName) + "</b>");
			if (sd.status === "success") {
				lines.push(" - 抓取 " + sd.itemsFound + " 条, 新增 " + sd.newItems + " 条");
			} else {
				lines.push(" - <span style=\"color:#FF3B30;\">" + escapeHtml(sd.errorMessage) + "</span>");
			}
			lines.push("</p>");
		}
		lines.push("<hr/>");
	}

	if (errors && errors.length > 0) {
		lines.push("<h4>错误详情:</h4>");
		for (var j = 0; j < errors.length; j++) {
			lines.push("<p style=\"color:#FF3B30;font-size:12px;\">• " + escapeHtml(errors[j].source) + ": " + escapeHtml(errors[j].message) + "</p>");
		}
		lines.push("<hr/>");
	}

	if (stats) {
		lines.push("<p style=\"font-size:12px;\">本次汇总: 总抓取 " + (stats.total || 0) + " 条, 新增 " + (stats.newItems || 0) + " 条, 关键字命中 " + (stats.matchedItems || 0) + " 条</p>");
	}

	lines.push("<p style=\"color:#999;font-size:11px;\">由采购信息监控系统自动推送</p>");
	return lines.join("\n");
}

function escapeHtml(str) {
	if (!str) {
		return "";
	}
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function sendNotification(token, items) {
	if (!token || !items || items.length === 0) {
		console.log("[PushPlus] 无需推送: token=" + !!token + ", items=" + (items ? items.length : 0));
		return Promise.resolve({ success: true, skipped: true });
	}

	var title = "新增 " + items.length + " 条设备采购信息";
	var content = buildHtmlMessage(items);

	return doSend(token, title, content);
}

function sendErrorNotification(token, sourceDetails, errors, stats) {
	if (!token || !errors || errors.length === 0) {
		return Promise.resolve({ success: true, skipped: true });
	}

	var failCount = 0;
	for (var i = 0; i < sourceDetails.length; i++) {
		if (sourceDetails[i].status === "error") {
			failCount++;
		}
	}

	var title = "抓取异常: " + failCount + " 个网站失败";
	var content = buildErrorMessage(sourceDetails, errors, stats);

	return doSend(token, title, content);
}

function doSend(token, title, content) {
	return axios({
		method: "POST",
		url: PUSHPLUS_API,
		data: {
			token: token,
			title: title,
			content: content,
			template: "html"
		},
		headers: {
			"Content-Type": "application/json"
		},
		timeout: 15000
	}).then(function(res) {
		var data = res.data;
		if (data.code === 200) {
			console.log("[PushPlus] 推送成功: " + title);
			return { success: true, message: data.msg };
		} else {
			console.error("[PushPlus] 推送失败: " + JSON.stringify(data));
			return { success: false, message: data.msg };
		}
	}).catch(function(err) {
		console.error("[PushPlus] 推送异常: " + err.message);
		return { success: false, message: err.message };
	});
}

module.exports = {
	sendNotification: sendNotification,
	sendErrorNotification: sendErrorNotification,
	buildHtmlMessage: buildHtmlMessage,
	buildErrorMessage: buildErrorMessage
};
