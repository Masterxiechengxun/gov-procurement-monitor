var cloud = require("wx-server-sdk");

cloud.init({
	env: cloud.DYNAMIC_CURRENT_ENV
});

var db = cloud.database();
var _ = db.command;

var DEFAULT_RETENTION_DAYS = 90;
var BATCH_SIZE = 100;

exports.main = function(event, context) {
	return loadRetentionDays()
		.then(function(retentionDays) {
			console.log("[Clean] 开始清理 " + retentionDays + " 天前的数据");

			var cutoffDate = getChinaTime();
			cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
			var cutoffStr = formatDate(cutoffDate);

			var totalDeleted = 0;

			function deleteBatch() {
				return db.collection("procurements")
					.where({
						publishDate: _.lt(cutoffStr)
					})
					.limit(BATCH_SIZE)
					.get()
					.then(function(res) {
						if (res.data.length === 0) {
							return totalDeleted;
						}

						var ids = [];
						for (var i = 0; i < res.data.length; i++) {
							ids.push(res.data[i]._id);
						}

						return deleteByIds("procurements", ids).then(function(count) {
							totalDeleted += count;
							console.log("[Clean] 已删除 " + totalDeleted + " 条");

							if (res.data.length === BATCH_SIZE) {
								return deleteBatch();
							}
							return totalDeleted;
						});
					});
			}

			return deleteBatch()
				.then(function(count) {
					return cleanOldLogs(cutoffStr).then(function(logCount) {
						console.log("[Clean] 清理完成: 采购信息 " + count + " 条, 日志 " + logCount + " 条");
						return {
							code: 0,
							message: "清理完成",
							data: {
								procurementsDeleted: count,
								logsDeleted: logCount,
								retentionDays: retentionDays,
								cutoffDate: cutoffStr
							}
						};
					});
				});
		})
		.catch(function(err) {
			console.error("[Clean] 清理失败: " + err.message);
			return { code: -1, message: err.message, data: null };
		});
};

function loadRetentionDays() {
	return db.collection("config")
		.where({ key: "retention_days" })
		.limit(100)
		.get()
		.then(function(res) {
			if (res.data.length === 0) {
				return DEFAULT_RETENTION_DAYS;
			}
			var maxDays = DEFAULT_RETENTION_DAYS;
			for (var i = 0; i < res.data.length; i++) {
				var val = res.data[i].value;
				if (typeof val === "number" && val > maxDays) {
					maxDays = val;
				}
			}
			return maxDays;
		})
		.catch(function(err) {
			console.warn("[Clean] 读取保留天数失败，使用默认值:", err.message);
			return DEFAULT_RETENTION_DAYS;
		});
}

function deleteByIds(collection, ids) {
	var deleted = 0;

	function delNext(index) {
		if (index >= ids.length) {
			return Promise.resolve(deleted);
		}

		return db.collection(collection)
			.doc(ids[index])
			.remove()
			.then(function() {
				deleted++;
				return delNext(index + 1);
			})
			.catch(function() {
				return delNext(index + 1);
			});
	}

	return delNext(0);
}

function cleanOldLogs(cutoffStr) {
	var totalDeleted = 0;

	function deleteBatch() {
		return db.collection("crawl_log")
			.where({
				date: _.lt(cutoffStr)
			})
			.limit(BATCH_SIZE)
			.get()
			.then(function(res) {
				if (res.data.length === 0) {
					return totalDeleted;
				}

				var ids = [];
				for (var i = 0; i < res.data.length; i++) {
					ids.push(res.data[i]._id);
				}

				return deleteByIds("crawl_log", ids).then(function(count) {
					totalDeleted += count;

					if (res.data.length === BATCH_SIZE) {
						return deleteBatch();
					}
					return totalDeleted;
				});
			})
			.catch(function() {
				return totalDeleted;
			});
	}

	return deleteBatch();
}

function getChinaTime() {
	var now = new Date();
	var offset = now.getTimezoneOffset();
	return new Date(now.getTime() + (offset + 480) * 60000);
}

function formatDate(date) {
	var y = date.getFullYear();
	var m = date.getMonth() + 1;
	var d = date.getDate();
	return y + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
}
