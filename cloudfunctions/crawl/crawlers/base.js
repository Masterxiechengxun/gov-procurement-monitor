var axios = require("axios");

var DEFAULT_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
	"Accept-Encoding": "gzip, deflate",
	"Connection": "keep-alive"
};

function sleep(ms) {
	return new Promise(function(resolve) {
		setTimeout(resolve, ms);
	});
}

function BaseCrawler(config) {
	this.config = config;
	this.name = config.name || "unknown";
	this.id = config.id || "unknown";
	this.requestDelay = 1000;
	this.maxRetries = 2;
}

BaseCrawler.prototype.fetch = function(url, options) {
	var self = this;
	var retries = 0;
	var opts = options || {};

	function attempt() {
		var requestConfig = {
			url: url,
			method: opts.method || "GET",
			headers: Object.assign({}, DEFAULT_HEADERS, opts.headers || {}),
			timeout: 10000,
			responseType: opts.responseType || "text",
			maxRedirects: 5
		};
		if (opts.params) {
			requestConfig.params = opts.params;
		}
		if (opts.data) {
			requestConfig.data = opts.data;
		}

		return axios(requestConfig).catch(function(err) {
			retries++;
			if (retries < self.maxRetries) {
				console.log("[" + self.name + "] 请求失败，第" + retries + "次重试: " + url);
				return sleep(self.requestDelay).then(function() {
					return attempt();
				});
			}
			throw err;
		});
	}

	return attempt();
};

BaseCrawler.prototype.crawl = function() {
	throw new Error("子类必须实现 crawl 方法");
};

BaseCrawler.prototype.parseList = function() {
	throw new Error("子类必须实现 parseList 方法");
};

module.exports = {
	BaseCrawler: BaseCrawler,
	sleep: sleep,
	DEFAULT_HEADERS: DEFAULT_HEADERS
};
