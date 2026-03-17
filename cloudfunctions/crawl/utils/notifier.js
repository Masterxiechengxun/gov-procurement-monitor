var axios = require("axios");

var PUSHPLUS_API = "http://www.pushplus.plus/send";

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

function getFriendlyError(rawMessage) {
	var msg = rawMessage ? String(rawMessage).toLowerCase() : "";
	if (msg.indexOf("timeout") !== -1 || msg.indexOf("etimedout") !== -1) {
		return "网站访问超时（可能是网络波动或网站访问量过大）";
	}
	if (msg.indexOf("econnrefused") !== -1) {
		return "网站拒绝连接（可能正在维护中）";
	}
	if (msg.indexOf("enotfound") !== -1) {
		return "域名无法解析（本地网络或 DNS 异常）";
	}
	if (msg.indexOf("403") !== -1 || msg.indexOf("forbidden") !== -1) {
		return "访问被拒绝（网站可能限制了自动化访问）";
	}
	if (msg.indexOf("404") !== -1 || msg.indexOf("not found") !== -1) {
		return "页面不存在（网站结构可能已更新）";
	}
	if (msg.indexOf("500") !== -1 || msg.indexOf("502") !== -1 || msg.indexOf("503") !== -1) {
		return "网站服务器异常（可能正在维护或过载）";
	}
	if (msg.indexOf("页请求失败") !== -1) {
		return "部分页面抓取失败（网站响应不稳定，数据可能不完整）";
	}
	return "网站访问异常（原因未知，建议稍后再试）";
}

function buildSourceSummary(userItems) {
	if (!userItems || userItems.length === 0) {
		return "";
	}
	var counts = {};
	var order = [];
	for (var i = 0; i < userItems.length; i++) {
		var name = userItems[i].sourceName || "未知来源";
		if (!counts[name]) {
			counts[name] = 0;
			order.push(name);
		}
		counts[name]++;
	}
	var parts = [];
	for (var j = 0; j < order.length; j++) {
		// escapeHtml 在此处转义 sourceName，buildReport 直接插入 summary 无需再包 escapeHtml
		parts.push(escapeHtml(order[j]) + " " + counts[order[j]] + " 条");
	}
	return "来源：" + parts.join(" · ");
}

function highlightKeywords(title, matchedKeywords) {
	var safeTitle = escapeHtml(title || "");
	if (!matchedKeywords || matchedKeywords.length === 0) {
		return safeTitle;
	}
	for (var i = 0; i < matchedKeywords.length; i++) {
		var kw = escapeHtml(String(matchedKeywords[i]));
		if (!kw) continue;
		// 全局替换（不区分大小写），保留原始大小写
		var regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
		safeTitle = safeTitle.replace(regex, function(match) {
			return "<span style=\"color:#FF3B30;\">" + match + "</span>";
		});
	}
	return safeTitle;
}

var sources = require("../config/sources");

function buildItemsHtml(userItems) {
	var lines = [];
	for (var i = 0; i < userItems.length; i++) {
		var item = userItems[i];
		var idx = i + 1;
		lines.push("<div style=\"margin-bottom:15px;\">");
		lines.push("<p><b>" + idx + ". " + highlightKeywords(item.title, item.matchedKeywords) + "</b></p>");
		lines.push("<p style=\"color:#666;font-size:12px;\">来源：" + escapeHtml(item.sourceName) + " | 日期：" + escapeHtml(item.publishDate) + "</p>");
		if (item.buyer || item.region) {
			var meta = [];
			if (item.buyer) meta.push("采购人：" + escapeHtml(item.buyer));
			if (item.region) meta.push("地区：" + escapeHtml(item.region));
			lines.push("<p style=\"color:#666;font-size:12px;\">" + meta.join(" | ") + "</p>");
		}
		if (item.url) {
			lines.push("<p><a href=\"" + escapeHtml(item.url) + "\" style=\"color:#2B5CE6;\">点击查看原文 →</a></p>");
		}
		lines.push("</div>");
		lines.push("<hr/>");
	}
	return lines.join("\n");
}

function buildErrorSourcesHtml(errorSources) {
	var lines = [];
	for (var i = 0; i < errorSources.length; i++) {
		var sd = errorSources[i];
		lines.push("<p><b>❌ " + escapeHtml(sd.sourceName) + "</b></p>");
		lines.push("<p style=\"color:#666;font-size:12px;\">原因：" + getFriendlyError(sd.errorMessage) + "</p>");
		var src = sources.getSourceById(sd.sourceId);
		if (src && src.website) {
			lines.push("<p><a href=\"" + escapeHtml(src.website) + "\" style=\"color:#2B5CE6;\">手动查看 →</a></p>");
		}
	}
	return lines.join("\n");
}

function buildReport(userItems, sourceDetails, stats) {
	var now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
	var details = sourceDetails || [];
	var errorSources = details.filter(function(s) { return s.status !== "success"; });

	// 场景 4：无命中，无错误 → 返回 null，外层跳过推送
	if (userItems.length === 0 && errorSources.length === 0) {
		return null;
	}

	var lines = [];
	var title;

	if (userItems.length > 0) {
		// 场景 1 或 场景 2
		if (errorSources.length > 0) {
			title = "今日新增 " + userItems.length + " 条设备采购信息（" + errorSources.length + " 个网站异常）";
		} else {
			title = "今日新增 " + userItems.length + " 条设备采购信息";
		}

		lines.push("<h3>今日设备采购信息 · 共 " + userItems.length + " 条</h3>");
		var summary = buildSourceSummary(userItems);
		if (summary) {
			// summary 内部已对 sourceName 做 escapeHtml，此处直接插入
			lines.push("<p style=\"color:#666;font-size:12px;\">" + summary + "</p>");
		}
		lines.push("<p style=\"color:#666;font-size:12px;\">推送时间：" + now + "</p>");
		lines.push("<hr/>");
		lines.push(buildItemsHtml(userItems));

		if (errorSources.length > 0) {
			// 场景 2：尾部附加错误警告
			lines.push("<h4 style=\"color:#FF8C00;\">注意：以下网站今日数据可能不完整，建议手动补查</h4>");
			lines.push(buildErrorSourcesHtml(errorSources));
			lines.push("<hr/>");
		}
	} else {
		// 场景 3：无命中，有错误
		title = "今日自动抓取未完成，请手动查看";
		lines.push("<h3 style=\"color:#FF3B30;\">今日设备采购信息自动抓取未完成</h3>");
		lines.push("<p style=\"color:#666;font-size:12px;\">推送时间：" + now + "</p>");
		lines.push("<p>以下网站访问失败，今日数据可能有遗漏，<br/>为避免耽误工作，建议手动前往查看：</p>");
		lines.push("<hr/>");
		lines.push(buildErrorSourcesHtml(errorSources));
		lines.push("<hr/>");

		var total = (stats && stats.total) || 0;
		var newItems = (stats && stats.newItems) || 0;
		var summaryLine = "本次运行摘要：共抓取 " + total + " 条，新增 " + newItems + " 条";
		if (newItems > 0) {
			summaryLine += "（无关键字命中）";
		}
		lines.push("<p style=\"font-size:12px;\">" + summaryLine + "</p>");
	}

	lines.push("<p style=\"color:#999;font-size:11px;\">由采购信息监控系统自动推送</p>");

	return { title: title, content: lines.join("\n") };
}

function sendNotification(token, userItems, sourceDetails, stats) {
	if (!token) {
		console.log("[PushPlus] 无 token，跳过推送");
		return Promise.resolve({ success: true, skipped: true });
	}
	var report = buildReport(userItems || [], sourceDetails || [], stats || {});
	if (report === null) {
		console.log("[PushPlus] 无需推送（无命中且无错误）");
		return Promise.resolve({ success: true, skipped: true });
	}
	return doSend(token, report.title, report.content);
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
	buildReport: buildReport,
	buildSourceSummary: buildSourceSummary,
	highlightKeywords: highlightKeywords,
	getFriendlyError: getFriendlyError
};
