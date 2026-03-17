var notifier = require("./utils/notifier");
var passed = 0;
var failed = 0;

function assert(desc, actual, expected) {
	if (actual === expected) {
		console.log("  PASS: " + desc);
		passed++;
	} else {
		console.error("  FAIL: " + desc);
		console.error("    expected: " + JSON.stringify(expected));
		console.error("    actual:   " + JSON.stringify(actual));
		failed++;
	}
}

console.log("\n=== getFriendlyError ===");
assert("timeout", notifier.getFriendlyError("connect ETIMEDOUT"), "网站访问超时（可能是网络波动或网站访问量过大）");
assert("timeout lowercase", notifier.getFriendlyError("timeout of 5000ms exceeded"), "网站访问超时（可能是网络波动或网站访问量过大）");
assert("econnrefused", notifier.getFriendlyError("connect ECONNREFUSED"), "网站拒绝连接（可能正在维护中）");
assert("enotfound", notifier.getFriendlyError("getaddrinfo ENOTFOUND"), "域名无法解析（本地网络或 DNS 异常）");
assert("403", notifier.getFriendlyError("Request failed with status code 403"), "访问被拒绝（网站可能限制了自动化访问）");
assert("forbidden", notifier.getFriendlyError("403 Forbidden"), "访问被拒绝（网站可能限制了自动化访问）");
assert("404", notifier.getFriendlyError("Request failed with status code 404"), "页面不存在（网站结构可能已更新）");
assert("500", notifier.getFriendlyError("Request failed with status code 500"), "网站服务器异常（可能正在维护或过载）");
assert("503", notifier.getFriendlyError("503 Service Unavailable"), "网站服务器异常（可能正在维护或过载）");
assert("partial", notifier.getFriendlyError("3 页请求失败"), "部分页面抓取失败（网站响应不稳定，数据可能不完整）");
assert("unknown", notifier.getFriendlyError("some unexpected error"), "网站访问异常（原因未知，建议稍后再试）");
assert("null input", notifier.getFriendlyError(null), "网站访问异常（原因未知，建议稍后再试）");

console.log("\n=== buildSourceSummary ===");
assert("空数组", notifier.buildSourceSummary([]), "");
assert("单来源",
	notifier.buildSourceSummary([
		{ sourceName: "中国政府采购网" },
		{ sourceName: "中国政府采购网" },
		{ sourceName: "中国政府采购网" }
	]),
	"来源：中国政府采购网 3 条"
);
assert("多来源",
	notifier.buildSourceSummary([
		{ sourceName: "中国政府采购网" },
		{ sourceName: "中国政府采购网" },
		{ sourceName: "四川省公共资源交易网" }
	]),
	"来源：中国政府采购网 2 条 · 四川省公共资源交易网 1 条"
);
assert("sourceName 为空",
	notifier.buildSourceSummary([{ sourceName: "" }, { sourceName: undefined }]),
	"来源：未知来源 2 条"
);

console.log("\n=== highlightKeywords ===");
assert("无关键字",
	notifier.highlightKeywords("气相色谱仪采购项目", []),
	"气相色谱仪采购项目"
);
assert("单关键字命中",
	notifier.highlightKeywords("气相色谱仪采购项目", ["气相色谱仪"]),
	'<span style="color:#FF3B30;">气相色谱仪</span>采购项目'
);
assert("多关键字命中",
	notifier.highlightKeywords("气相色谱仪及质谱仪采购", ["气相色谱仪", "质谱仪"]),
	'<span style="color:#FF3B30;">气相色谱仪</span>及<span style="color:#FF3B30;">质谱仪</span>采购'
);
assert("关键字出现多次",
	notifier.highlightKeywords("色谱仪与色谱仪对比", ["色谱仪"]),
	'<span style="color:#FF3B30;">色谱仪</span>与<span style="color:#FF3B30;">色谱仪</span>对比'
);
assert("title 为空",
	notifier.highlightKeywords("", ["气相色谱仪"]),
	""
);
assert("matchedKeywords 为 null",
	notifier.highlightKeywords("气相色谱仪采购项目", null),
	"气相色谱仪采购项目"
);
assert("title 含 HTML 特殊字符被转义",
	notifier.highlightKeywords("采购<仪器>", []),
	"采购&lt;仪器&gt;"
);

console.log("\n=== buildReport ===");

var mockSourceDetails = [
	{ sourceId: "ccgp", sourceName: "中国政府采购网", status: "success", errorMessage: "" },
	{ sourceId: "sichuan_ggzy", sourceName: "四川省公共资源交易网", status: "success", errorMessage: "" }
];
var mockErrorSourceDetails = [
	{ sourceId: "ccgp", sourceName: "中国政府采购网", status: "success", errorMessage: "" },
	{ sourceId: "sichuan_ggzy", sourceName: "四川省公共资源交易网", status: "error", errorMessage: "connect ETIMEDOUT" }
];
var mockItems = [
	{ title: "气相色谱仪采购项目", sourceName: "中国政府采购网", publishDate: "2026-03-17",
	  buyer: "XX大学", region: "四川省", matchedKeywords: ["气相色谱仪"], url: "https://example.com/1" }
];
var mockStats = { total: 50, newItems: 5 };
var mockStatsNoNew = { total: 50, newItems: 0 };

// 场景 4：null
var r4 = notifier.buildReport([], mockSourceDetails, mockStats);
assert("场景4 返回 null", r4, null);

// 场景 1：有命中无错误
var r1 = notifier.buildReport(mockItems, mockSourceDetails, mockStats);
assert("场景1 title", r1 && r1.title, "今日新增 1 条设备采购信息");
assert("场景1 content 含标题关键字标红", !!(r1 && r1.content.indexOf("color:#FF3B30;") !== -1), true);
assert("场景1 content 含来源", !!(r1 && r1.content.indexOf("中国政府采购网") !== -1), true);
assert("场景1 content 无错误区块", !!(r1 && r1.content.indexOf("注意：以下网站") === -1), true);

// 场景 2：有命中有错误
var r2 = notifier.buildReport(mockItems, mockErrorSourceDetails, mockStats);
assert("场景2 title 含异常数", !!(r2 && r2.title.indexOf("1 个网站异常") !== -1), true);
assert("场景2 content 含错误警告", !!(r2 && r2.content.indexOf("注意：以下网站今日数据可能不完整") !== -1), true);
assert("场景2 content 含友好错误文案", !!(r2 && r2.content.indexOf("网站访问超时") !== -1), true);

// 场景 3：无命中有错误，新增>0
var r3a = notifier.buildReport([], mockErrorSourceDetails, mockStats);
assert("场景3 title", r3a && r3a.title, "今日自动抓取未完成，请手动查看");
assert("场景3 摘要含'无关键字命中'", !!(r3a && r3a.content.indexOf("无关键字命中") !== -1), true);

// 场景 3：无命中有错误，新增=0
var r3b = notifier.buildReport([], mockErrorSourceDetails, mockStatsNoNew);
assert("场景3 新增0时不含'无关键字命中'", !!(r3b && r3b.content.indexOf("无关键字命中") === -1), true);
assert("场景3 含手动查看链接", !!(r3b && r3b.content.indexOf("手动查看") !== -1), true);

console.log("\n结果：" + passed + " passed, " + failed + " failed\n");
