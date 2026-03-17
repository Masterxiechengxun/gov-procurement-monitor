# 微信推送通知重新设计 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构微信推送通知，将每日自动抓取结果以来源分类汇总、关键字标红标题、友好错误文案的方式合并推送给用户。

**Architecture:** 将 `notifier.js` 中分散的两套构建函数整合为单一 `buildReport`，根据命中结果和错误来源自动选择消息场景；`index.js` 中用 `sendAllNotifications` 替换原来串行调用的 `sendNotifications` + `sendErrorNotifications`。

**Tech Stack:** Node.js (ES5 风格), axios, PushPlus HTML 推送模板

---

## 文件结构

| 文件 | 操作 | 说明 |
|---|---|---|
| `cloudfunctions/crawl/utils/notifier.js` | 大幅修改 | 删除旧函数，新增 `getFriendlyError`、`buildSourceSummary`、`highlightKeywords`、`buildReport`，更新 `sendNotification` 签名 |
| `cloudfunctions/crawl/index.js` | 局部修改 | 删除 `sendNotifications` 和 `sendErrorNotifications`，新增 `sendAllNotifications`，更新 `executeCrawl` 调用链 |
| `cloudfunctions/crawl/test-notifier.js` | 新建（临时） | 纯 Node.js 验证脚本，`node test-notifier.js` 直接运行，无需测试框架 |

---

## Chunk 1: 重写 notifier.js

### Task 1: 新增 `getFriendlyError`

**Files:**
- Modify: `cloudfunctions/crawl/utils/notifier.js`

- [ ] **Step 1.1: 在 `notifier.js` 中，在 `escapeHtml` 函数之后添加 `getFriendlyError`**

  打开 `cloudfunctions/crawl/utils/notifier.js`，在 `escapeHtml` 函数定义之后（约第 98 行）插入：

  ```js
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
  ```

- [ ] **Step 1.2: 创建 `test-notifier.js` 并写 `getFriendlyError` 测试**

  新建 `cloudfunctions/crawl/test-notifier.js`：

  ```js
  var notifier = require("./utils/notifier");
  var passed = 0;
  var failed = 0;

  function assert(desc, actual, expected) {
  	if (actual === expected) {
  		console.log("  PASS: " + desc);
  		passed++;
  	} else {
  		console.error("  FAIL: " + desc);
  		console.error("    expected: " + expected);
  		console.error("    actual:   " + actual);
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

  console.log("\n结果：" + passed + " passed, " + failed + " failed\n");
  ```

- [ ] **Step 1.3: 运行测试**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl && node test-notifier.js
  ```

  预期：`getFriendlyError` 部分全部 PASS，其余测试因函数未定义而报错（属正常，后续步骤逐步添加）。

---

### Task 2: 新增 `buildSourceSummary`

**Files:**
- Modify: `cloudfunctions/crawl/utils/notifier.js`

- [ ] **Step 2.1: 在 `getFriendlyError` 之后添加 `buildSourceSummary`**

  ```js
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
  ```
  > 注：`buildSourceSummary` 返回值已对 sourceName 做 HTML 转义，包含"来源："前缀，`buildReport` 直接嵌入 `<p>` 标签，不再对其调用 `escapeHtml`。

- [ ] **Step 2.2: 在 `test-notifier.js` 中追加 `buildSourceSummary` 测试**

  在文件末尾（`console.log("\n结果…")` 之前）追加：

  ```js
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
  ```

- [ ] **Step 2.3: 运行测试**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl && node test-notifier.js
  ```

  预期：`getFriendlyError` 和 `buildSourceSummary` 部分全部 PASS。

---

### Task 3: 新增 `highlightKeywords`

**Files:**
- Modify: `cloudfunctions/crawl/utils/notifier.js`

- [ ] **Step 3.1: 在 `buildSourceSummary` 之后添加 `highlightKeywords`**

  注意：标题需先 `escapeHtml` 再做关键字替换，避免 XSS。替换时对关键字本身也做 `escapeHtml` 处理。

  ```js
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
  ```

- [ ] **Step 3.2: 在 `test-notifier.js` 中追加 `highlightKeywords` 测试**

  ```js
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
  ```

- [ ] **Step 3.3: 运行测试**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl && node test-notifier.js
  ```

  预期：前三个测试套件全部 PASS。

---

### Task 4: 新增 `buildReport`

**Files:**
- Modify: `cloudfunctions/crawl/utils/notifier.js`

- [ ] **Step 4.1: 在 `highlightKeywords` 之后添加辅助函数 `buildItemsHtml` 和 `buildErrorSourcesHtml`**

  将条目列表和错误区块的 HTML 构建分开，让 `buildReport` 保持清晰。

  ```js
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
  ```

- [ ] **Step 4.2: 添加 `buildReport` 主函数**

  ```js
  function buildReport(userItems, sourceDetails, stats) {
  	var now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  	var errorSources = sourceDetails.filter(function(s) { return s.status !== "success"; });

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
  ```

- [ ] **Step 4.3: 在 `test-notifier.js` 中追加 `buildReport` 测试**

  ```js
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
  assert("场景1 content 含标题", !!(r1 && r1.content.indexOf("气相色谱仪") !== -1), true);
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
  ```

- [ ] **Step 4.4: 运行测试**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl && node test-notifier.js
  ```

  预期：所有 `buildReport` 测试 PASS。

---

### Task 5: 更新 `sendNotification` 签名，删除旧函数，更新 exports

**Files:**
- Modify: `cloudfunctions/crawl/utils/notifier.js`

- [ ] **Step 5.1: 将现有 `sendNotification` 函数替换为新签名版本**

  找到当前的 `sendNotification` 函数（第 100-110 行）：
  ```js
  function sendNotification(token, items) {
      if (!token || !items || items.length === 0) { ... }
      var title = ...
      var content = buildHtmlMessage(items);
      return doSend(token, title, content);
  }
  ```

  替换为：
  ```js
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
  ```

- [ ] **Step 5.2: 删除旧的三个函数**

  按函数名搜索并删除以下函数的完整定义（从 `function` 关键字到对应的最后一个 `}`）。
  **注意：Tasks 1-4 已向文件插入大量新代码，原始行号已失效，请按函数名定位：**
  - `function buildHtmlMessage(items)`
  - `function buildErrorMessage(sourceDetails, errors, stats)`
  - `function sendErrorNotification(token, sourceDetails, errors, stats)`

- [ ] **Step 5.3: 将 `module.exports` 替换为新版**

  找到文件末尾的 `module.exports = { ... }`，替换为：

  ```js
  module.exports = {
  	sendNotification: sendNotification,
  	buildReport: buildReport,
  	buildSourceSummary: buildSourceSummary,
  	highlightKeywords: highlightKeywords,
  	getFriendlyError: getFriendlyError
  };
  ```

- [ ] **Step 5.4: 运行完整测试**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl && node test-notifier.js
  ```

  预期：所有测试套件全部 PASS，0 failed。

- [ ] **Step 5.5: Commit**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler
  git add cloudfunctions/crawl/utils/notifier.js cloudfunctions/crawl/test-notifier.js
  git commit -m "feat: 重构 notifier.js，统一消息构建逻辑，添加关键字标红和友好错误文案"
  ```

---

## Chunk 2: 更新 index.js

### Task 6: 新增 `sendAllNotifications`，替换旧推送函数

**Files:**
- Modify: `cloudfunctions/crawl/index.js`

- [ ] **Step 6.1: 找到 `sendNotifications` 函数的起始行**

  在 `index.js` 中搜索 `function sendNotifications`，定位函数的完整范围（约第 496-537 行）。

- [ ] **Step 6.2: 将 `sendNotifications` 和 `sendErrorNotifications` 两个函数一并替换为 `sendAllNotifications`**

  用以下代码完整替换从 `function sendNotifications` 到 `sendErrorNotifications` 函数末尾的所有内容（含两个函数，约第 496-570 行）：

  ```js
  /**
   * 统一推送入口，合并成功通知和错误通知为单条消息。
   * 场景判断逻辑在 notifier.buildReport 内部执行。
   */
  function sendAllNotifications(results, userMap) {
  	var users = Object.keys(userMap);
  	var stats = {
  		total: results.total || 0,
  		newItems: results.newItems || 0
  	};

  	function notifyNext(idx) {
  		if (idx >= users.length) {
  			return Promise.resolve();
  		}

  		var uid = users[idx];
  		var config = userMap[uid];
  		var token = config["pushplus_token"];

  		if (!token) {
  			return notifyNext(idx + 1);
  		}

  		// results._matchedNewItems 由 deduplicateAndSave 在抓取阶段动态附加，
  		// 收集了命中任意用户关键字的新增条目；若无命中则不存在该字段，|| [] 兜底
  		var userItems = filterItemsByUserKeywords(
  			results._matchedNewItems || [],
  			config["custom_keywords"]
  		);
  		var blacklist = config["blacklist_keywords"];
  		userItems = filterItemsByBlacklist(userItems, blacklist);

  		// 预检场景 4：无命中且无错误来源，跳过（notifier 内部也会做此判断，此处提前跳过避免无意义调用）
  		var hasErrors = results.sourceDetails && results.sourceDetails.some(function(s) {
  			return s.status !== "success";
  		});
  		if (userItems.length === 0 && !hasErrors) {
  			console.log("[Crawl] 用户 " + uid.substring(0, 8) + "... 无命中且无错误，跳过推送");
  			return notifyNext(idx + 1);
  		}

  		var uidShort = uid.length > 8 ? uid.substring(0, 8) + "..." : uid;
  		console.log("[Crawl] 向用户 " + uidShort + " 推送（命中 " + userItems.length + " 条，错误来源 " + (hasErrors ? ">0" : "0") + "）");

  		return notifier.sendNotification(token, userItems, results.sourceDetails || [], stats)
  			.then(function() {
  				return notifyNext(idx + 1);
  			});
  	}

  	return notifyNext(0);
  }
  ```

- [ ] **Step 6.3: 更新 `executeCrawl` 中的调用链**

  在 `index.js` 第 66-71 行找到（含 Tab 缩进，共两个 `.then` 节点）：
  ```js
  		.then(function() {
  			return sendNotifications(crawlResults, allUsersConfig);
  		})
  		.then(function() {
  			return sendErrorNotifications(crawlResults, allUsersConfig);
  		})
  ```

  将上述六行整体替换为：
  ```js
  		.then(function() {
  			return sendAllNotifications(crawlResults, allUsersConfig);
  		})
  ```

- [ ] **Step 6.4: 验证 `index.js` 中无残留的旧函数引用**

  运行以下命令，确认输出为空（无匹配）：

  ```bash
  grep -n "sendNotifications\|sendErrorNotifications\|sendErrorNotification" /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl/index.js
  ```

  预期：无任何输出。若仍有匹配行，说明有残留引用未清理干净，需检查并删除。

- [ ] **Step 6.5: 验证 `index.js` 语法正确**

  ```bash
  node --check /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl/index.js && echo "语法OK"
  ```

  预期：输出 `语法OK`，无报错。

- [ ] **Step 6.6: Commit**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler
  git add cloudfunctions/crawl/index.js
  git commit -m "feat: 用 sendAllNotifications 替换分散的推送函数，合并成功/错误通知"
  ```

---

### Task 7: 清理测试文件

- [ ] **Step 7.1: 删除临时测试脚本**

  `test-notifier.js` 是开发期验证脚本，不应随云函数上传部署。

  ```bash
  rm /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/crawl/test-notifier.js
  ```

- [ ] **Step 7.2: Commit**

  ```bash
  cd /Users/xiecx/Develop/personal/InfoCrawler
  git add cloudfunctions/crawl/test-notifier.js
  git commit -m "chore: 删除 notifier 开发期验证脚本"
  ```

---

## 验收标准

- [ ] `node test-notifier.js`（执行期间）所有用例 PASS
- [ ] `node --check index.js` 无语法错误
- [ ] `index.js` 中无 `sendNotifications`、`sendErrorNotifications`、`sendErrorNotification` 引用
- [ ] `notifier.js` 中无 `buildHtmlMessage`、`buildErrorMessage` 定义
- [ ] 云函数上传部署后，触发一次手动抓取，检查微信收到的推送消息格式符合设计文档
