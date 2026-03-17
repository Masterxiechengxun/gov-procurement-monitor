var axios = require("axios");
var cheerio = require("cheerio");
var iconv = require("iconv-lite");

var DEFAULT_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
	"Connection": "keep-alive"
};

// 优先尝试的内容区域选择器（按权重排序）
var CONTENT_SELECTORS = [
	// CCGP（中国政府采购网）
	".vT_detail_main", "#center_qp", ".infoContent",
	// 四川省公共资源交易信息网
	".details-content", ".detail-content", "#detail_content",
	// 通用政府/CMS 选择器
	".article-content", ".article", "#article",
	".TRS_Editor", "#zoom", "#vContent", ".vContent",
	".content", "#content", ".main-content", "#mainContent",
	"article", ".view-content", "#view_content"
];

// 附件文件扩展名
var ATTACH_EXT = /\.(pdf|doc|docx|xls|xlsx|zip|rar|7z|txt)(\?.*)?$/i;

exports.main = function(event) {
	var url = event.url;
	if (!url || typeof url !== "string") {
		return { code: -1, message: "缺少 url 参数", data: null };
	}

	console.log("[getDetail] 抓取:", url);

	return fetchPage(url)
		.then(function(html) {
			var result = extractHtml(html);
			console.log("[getDetail] 解析完成, HTML长度=" + result.html.length);
			return { code: 0, message: "success", data: result };
		})
		.catch(function(err) {
			console.error("[getDetail] 失败:", err.message);
			return { code: -1, message: err.message || "抓取失败", data: null };
		});
};

function fetchPage(url) {
	return axios({
		url: url,
		method: "GET",
		headers: DEFAULT_HEADERS,
		timeout: 15000,
		responseType: "arraybuffer",
		maxRedirects: 5
	}).then(function(response) {
		var buffer = Buffer.from(response.data);

		// 检测编码：先扫描前 2000 字节的 ASCII 文本
		var sample = buffer.slice(0, 2000).toString("latin1");
		var charsetMatch = sample.match(/charset[=\s"']+([a-zA-Z0-9\-_]+)/i);
		var charset = charsetMatch ? charsetMatch[1].toLowerCase() : "utf-8";

		if (charset === "gbk" || charset === "gb2312" || charset === "gb18030") {
			return iconv.decode(buffer, "gbk");
		}
		return buffer.toString("utf-8");
	});
}

function extractHtml(html) {
	var $ = cheerio.load(html, { decodeEntities: false });

	// 移除干扰元素
	$("script, style, nav, header, footer, .navbar, .breadcrumb, #breadcrumb, .sidebar, #sidebar, .menu, #menu, .comment, #comment, iframe, object, embed").remove();

	// 找到正文区域
	var $content = findContentElement($);

	// 移除只含空白/&nbsp; 的空段落（消除大量空行）
	$content.find("p, br + br").each(function() {
		var text = $(this).text().replace(/[\s\u00a0]+/g, "");
		if (!text && !$(this).find("img, table").length) {
			$(this).remove();
		}
	});

	// 修复表格超宽：移除固定宽度，强制自适应，允许换行
	$content.find("table").each(function() {
		$(this).removeAttr("width").attr("style", "width:100%;max-width:100%;table-layout:fixed;word-break:break-all;");
	});
	$content.find("td, th").each(function() {
		$(this).removeAttr("width").removeAttr("nowrap").attr("style", "word-break:break-all;white-space:normal;");
	});
	$content.find("img").each(function() {
		$(this).removeAttr("width").removeAttr("height").attr("style", "max-width:100%;height:auto;");
	});

	// 返回正文区域的原始 HTML
	return {
		html: $content.html() || ""
	};
}

function findContentElement($) {
	var best = null;
	var bestLen = 0;

	for (var i = 0; i < CONTENT_SELECTORS.length; i++) {
		var $el = $(CONTENT_SELECTORS[i]).first();
		if ($el.length) {
			var len = $el.text().trim().length;
			if (len > bestLen) {
				bestLen = len;
				best = $el;
			}
		}
	}

	// 至少有 80 个字符的有效内容才算匹配成功
	if (best && bestLen > 80) {
		return best;
	}

	// 兜底：移除干扰后的 body
	return $("body");
}

function extractParagraphs($content, $) {
	var lines = [];
	var seen = {};

	// 先提取标题类元素
	$content.find("h1, h2, h3, h4, h5, h6").each(function() {
		var text = $(this).text().replace(/\s+/g, " ").trim();
		if (text.length > 2 && !seen[text]) {
			seen[text] = true;
			lines.push({ type: "heading", text: text });
		}
	});

	// 提取段落（跳过包含块级子元素的容器，避免重复）
	$content.find("p").each(function() {
		var $el = $(this);
		if ($el.find("p").length > 0) return; // 是容器段落，跳过
		var text = $el.text().replace(/\s+/g, " ").trim();
		if (text.length > 5 && !seen[text]) {
			seen[text] = true;
			lines.push({ type: "paragraph", text: text });
		}
	});

	// 提取表格行（用于采购信息汇总表）
	$content.find("tr").each(function() {
		var cells = [];
		$(this).find("td, th").each(function() {
			var t = $(this).text().replace(/\s+/g, " ").trim();
			if (t) cells.push(t);
		});
		if (cells.length >= 2) {
			var text = cells.join("  ");
			if (text.length > 5 && !seen[text]) {
				seen[text] = true;
				lines.push({ type: "table-row", text: text });
			}
		}
	});

	// 如果段落数太少（可能是纯 div 布局），提取所有叶子文本节点
	if (lines.length < 3) {
		$content.find("div, li, span").each(function() {
			var $el = $(this);
			// 只处理叶子节点（没有块级子元素）
			if ($el.find("div, p, ul, ol, table").length > 0) return;
			var text = $el.text().replace(/\s+/g, " ").trim();
			if (text.length > 10 && !seen[text]) {
				seen[text] = true;
				lines.push({ type: "paragraph", text: text });
			}
		});
	}

	return lines;
}

function extractAttachments($, pageUrl) {
	var attachments = [];
	var seen = {};

	$("a[href]").each(function() {
		var href = $(this).attr("href") || "";
		var text = $(this).text().replace(/\s+/g, " ").trim();

		// 判断是否为附件链接
		var isAttach = ATTACH_EXT.test(href) || ATTACH_EXT.test(text) ||
			(text && (text.indexOf("附件") !== -1 || text.indexOf("下载") !== -1) && href.length > 5);

		if (!isAttach) return;

		// 补全相对路径
		if (href && href.indexOf("http") !== 0 && href.indexOf("//") !== 0) {
			try {
				var base = pageUrl.replace(/\/[^\/]*$/, "/");
				if (href.indexOf("/") === 0) {
					var origin = pageUrl.match(/^(https?:\/\/[^\/]+)/);
					base = origin ? origin[1] : base;
				}
				href = base + href.replace(/^\//, "");
			} catch (e) {}
		}

		if (href && !seen[href]) {
			seen[href] = true;
			attachments.push({
				name: text || href.split("/").pop().split("?")[0] || "附件",
				url: href
			});
		}
	});

	return attachments;
}
