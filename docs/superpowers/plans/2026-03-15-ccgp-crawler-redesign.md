# CCGP 政府采购爬虫重设计 Implementation Plan

**状态：已完成（架构已调整）**

> **架构变更说明：** 原计划的两阶段架构（crawl + fetchDetail）已调整。第二阶段（fetchDetail 云函数）未实现，改为在小程序详情页使用 `<web-view>` 直接加载原始公告 URL。Chunk 2（fetchDetail）中的所有任务均不需要执行。

---

## Chunk 1: crawl 云函数改造 ✅

### Task 1: 修正 sources.js 静态配置 ✅

- [x] 更新 sources.js 中 ccgp 来源的固定参数（pinMu=0, bidType=0，移除 displayZone/zoneId）

### Task 2: 重写 ccgp.js 核心爬虫 ✅

- [x] ZONE_MAP 地区映射（30 个省级区域）
- [x] 动态分页解析（parseTotalPages，实际上限 maxPages=15）
- [x] region 参数支持，regionLabel 直接入库，不依赖 HTML 解析
- [x] 移除废弃字段（contentHtml / fetchRetryCount / detailFetchedAt）
- [x] 日期编码内化（formatCcgpDate 将 - 替换为 %3A）

### Task 3: 修改 crawl/index.js ✅

- [x] event 参数透传（kw / region / start_time / end_time / timeType / maxPages）
- [x] 新增 `detectStartDate(sourceId)` 智能起始日期检测（含格式校验 fallback）
- [x] 精简 `checkSchedule()`：移除 intervalHours / isMatchingHour / 最小间隔检查
- [x] 定时触发器改为每天 06:00（config.json: `0 0 6 * * * *`）

---

## Chunk 2: fetchDetail 云函数 ⛔ 不实现

> 改为 web-view 方案，此 Chunk 全部跳过。

---

## Chunk 3: 附加改进（在本次迭代中额外完成）✅

### 设置 UI 精简 ✅

- [x] 移除「系统触发器」只读区块
- [x] 移除「抓取间隔」picker（触发器已固定每天，小时粒度无意义）
- [x] 保留「启用」开关 + 「运行日期」picker（每天 / 仅工作日 / 仅周末）
- [x] 移除 settings.js 中 intervalOptions / intervalHours 相关代码
- [x] 移除 settings.wxss 中两区块样式

### UI/UX 修复 ✅

- [x] 首页 / 统计页底部 padding（180rpx）修复 tab bar 遮挡
- [x] 分页加载「加载中」文字提示 + 「没有更多了」底部指示
- [x] 移除统计页「监控源」卡片
- [x] loadList 分页列表改用 slice() 拷贝，避免直接修改 this.data

### clean 函数扩展 ✅

- [x] 新增 `cleanStaleFields()`：批量移除存量记录中的废弃字段（contentHtml / fetchRetryCount / detailFetchedAt）
- [x] 集成到主清理流程（cleanOldLogs 之后调用）

### getData 修复 ✅

- [x] buildWhere keyword 搜索加正则转义（防止特殊字符导致查询错误）
- [x] DEFAULT_SCHEDULE 移除 intervalHours 字段
