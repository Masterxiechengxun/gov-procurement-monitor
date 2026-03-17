# 详情页 web-view 改造 Implementation Plan

> ⚠️ **已废弃（2026-03-17）**
>
> 此方案（web-view + cover-view）因政府网站域名无法加入业务域名白名单而放弃。
> 实际采用的是**云函数抓取 + 原生渲染**方案，详见：
> - `docs/webview-proxy-solution.md`（方案对比与当前实现说明）
> - `docs/superpowers/specs/2026-03-17-detail-page-cloudfunction-rendering.md`（当前实现 spec）

---

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将采购详情页从小程序内渲染改为 web-view 直接加载原始 URL，移除 fetchDetail 云函数，添加带"返回"和"用浏览器打开"按钮的自定义顶部导航栏。

**Architecture:** 列表页通过导航参数传递 url/title，详情页零云函数调用，使用 `<cover-view>` 实现可覆盖 web-view 的自定义导航栏。

**Tech Stack:** 微信小程序（WXML/WXSS/JS），微信云函数，`<web-view>` + `<cover-view>` 组件

---

## Chunk 1: 删除 fetchDetail 云函数

### Task 1: 删除 fetchDetail 云函数目录

**Files:**
- Delete: `cloudfunctions/fetchDetail/`（整个目录）

- [ ] **Step 1: 删除 fetchDetail 目录**

```bash
rm -rf /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/fetchDetail
```

- [ ] **Step 2: 验证目录已删除**

```bash
ls /Users/xiecx/Develop/personal/InfoCrawler/cloudfunctions/
```

期望输出中**不含** `fetchDetail`，应只包含 `clean`、`crawl`、`getData` 等其他目录。

- [ ] **Step 3: 确认 project.config.json 无需修改**

`project.config.json` 使用 `"cloudfunctionRoot": "cloudfunctions/"` 自动扫描，无需手动移除 fetchDetail 配置项。

- [ ] **Step 4: Commit**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler
git add -A cloudfunctions/fetchDetail
git commit -m "feat: 删除 fetchDetail 云函数"
```

---

## Chunk 2: 修改列表页跳转逻辑

### Task 2: index.js — onCardTap 改为传递 url 和 title

**Files:**
- Modify: `miniprogram/pages/index/index.js`（`onCardTap` 函数，约第 215-218 行）

**背景：** `procurement-card` 组件通过 `triggerEvent("cardtap", { item: ... })` 传递完整记录，`e.detail.item` 包含 `url`、`title` 等字段。

- [ ] **Step 1: 在微信开发者工具中打开项目，确认当前 onCardTap 可以正常跳转详情页（记录现有行为）**

打开微信开发者工具 → 列表页 → 点击任意一条采购信息 → 确认能跳转到详情页

- [ ] **Step 2: 修改 miniprogram/pages/index/index.js 的 onCardTap 函数**

将：
```js
onCardTap: function(e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/detail/detail?id=" + id });
}
```

改为：
```js
onCardTap: function(e) {
    var item = e.detail.item;
    wx.navigateTo({
        url: "/pages/detail/detail?url=" + encodeURIComponent(item.url || "") +
             "&title=" + encodeURIComponent(item.title || "招标详情")
    });
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler
git add miniprogram/pages/index/index.js
git commit -m "feat: 列表页跳转改为传递 url/title 参数"
```

---

## Chunk 3: 重写详情页

### Task 3: detail.json — 启用自定义导航栏

**Files:**
- Modify: `miniprogram/pages/detail/detail.json`

- [ ] **Step 1: 修改 detail.json**

将文件内容替换为：
```json
{
	"usingComponents": {},
	"navigationStyle": "custom"
}
```

### Task 4: detail.js — 简化为 web-view 驱动

**Files:**
- Modify: `miniprogram/pages/detail/detail.js`（完整替换）

- [ ] **Step 1: 完整替换 detail.js**

```js
Page({
	data: {
		url: "",
		title: "",
		statusBarHeight: 0,
		navHeight: 0,
		error: ""
	},

	onLoad: function(options) {
		var info = wx.getSystemInfoSync();
		var statusBarHeight = info.statusBarHeight || 0;
		var navHeight = statusBarHeight + 44;
		var url = options.url ? decodeURIComponent(options.url) : "";
		var title = options.title ? decodeURIComponent(options.title) : "招标详情";
		this.setData({
			url: url,
			title: title,
			statusBarHeight: statusBarHeight,
			navHeight: navHeight,
			error: url ? "" : "缺少页面地址"
		});
	},

	goBack: function() {
		wx.navigateBack();
	},

	openInBrowser: function() {
		var url = this.data.url;
		if (!url) return;
		wx.setClipboardData({
			data: url,
			success: function() {
				wx.showToast({
					title: "链接已复制，请在浏览器粘贴打开",
					icon: "none",
					duration: 3000
				});
			}
		});
	}
});
```

### Task 5: detail.wxml — cover-view 导航栏 + web-view

**Files:**
- Modify: `miniprogram/pages/detail/detail.wxml`（完整替换）

**注意：**
- `<cover-view>` 内部只能嵌套 `<cover-view>`、`<cover-image>`，文字直接写在 `<cover-view>` 标签内（不能用 `<text>` 子节点）
- `<web-view>` 自动铺满全屏，`<cover-view>` 浮于其上

- [ ] **Step 1: 完整替换 detail.wxml**

```xml
<!-- 自定义导航栏：cover-view 可覆盖在 web-view 之上 -->
<cover-view class="nav-bar" style="height:{{navHeight}}px">
	<cover-view class="nav-status" style="height:{{statusBarHeight}}px"></cover-view>
	<cover-view class="nav-actions">
		<cover-view class="nav-btn nav-btn-left" bindtap="goBack">‹ 返回</cover-view>
		<cover-view class="nav-title">{{title}}</cover-view>
		<cover-view class="nav-btn nav-btn-right" bindtap="openInBrowser">浏览器</cover-view>
	</cover-view>
</cover-view>

<!-- web-view 铺满全屏，cover-view 导航栏浮于其上 -->
<web-view wx:if="{{url && !error}}" src="{{url}}"></web-view>

<!-- 错误态（无 url 时） -->
<view wx:if="{{error}}" class="err-wrap" style="padding-top:{{navHeight}}px">
	<view class="err-icon"></view>
	<text class="err-txt">{{error}}</text>
	<view class="err-back-btn" bindtap="goBack">返回</view>
</view>
```

### Task 6: detail.wxss — 自定义导航栏样式

**Files:**
- Modify: `miniprogram/pages/detail/detail.wxss`（完整替换，移除所有旧 `.dt-*` 样式）

- [ ] **Step 1: 完整替换 detail.wxss**

```css
/* ==================== 自定义导航栏（cover-view） ==================== */

.nav-bar {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	background: #FFFFFF;
	z-index: 9999;
	box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
}

.nav-status {
	width: 100%;
}

.nav-actions {
	height: 44px;
	display: flex;
	flex-direction: row;
	align-items: center;
}

.nav-btn {
	width: 110rpx;
	height: 44px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	font-size: 28rpx;
	color: #2563EB;
}

.nav-btn-left {
	padding-left: 8rpx;
	font-size: 32rpx;
}

.nav-btn-right {
	font-size: 24rpx;
	padding-right: 8rpx;
}

.nav-title {
	flex: 1;
	height: 44px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 30rpx;
	font-weight: 600;
	color: #0F172A;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	text-align: center;
}

/* ==================== 错误态 ==================== */

.err-wrap {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 60vh;
	gap: 24rpx;
	padding: 40rpx;
}

.err-icon {
	width: 80rpx;
	height: 80rpx;
	border: 6rpx solid #CBD5E1;
	border-radius: 50%;
	margin-bottom: 8rpx;
}

.err-txt {
	font-size: 28rpx;
	color: #64748B;
}

.err-back-btn {
	background: #2563EB;
	color: #FFFFFF;
	padding: 18rpx 48rpx;
	border-radius: 12rpx;
	font-size: 28rpx;
	margin-top: 8rpx;
}
```

- [ ] **Step 2: 在微信开发者工具中编译，验证以下行为**

  1. 列表页点击任意采购信息卡片 → 跳转详情页
  2. 详情页顶部出现自定义导航栏（白色背景，左"‹ 返回"，右"浏览器"）
  3. 导航栏下方 web-view 加载招标原始页面（需确认 ccgp.gov.cn 和 ggzyjy.sc.gov.cn 已加入微信公众平台"业务域名"白名单，否则真机上 web-view 会被拦截；开发者工具中不校验域名可正常加载）
  4. 点击"‹ 返回"→ 回到列表页
  5. 点击"浏览器"→ 弹出 Toast "链接已复制，请在浏览器粘贴打开"
  6. 错误态验证：在微信开发者工具"编译模式"中设置启动页为 `/pages/detail/detail`（不带 url 参数） → 应显示错误提示"缺少页面地址"和"返回"按钮，点击"返回"能正常返回

- [ ] **Step 3: Commit**

```bash
cd /Users/xiecx/Develop/personal/InfoCrawler
git add miniprogram/pages/detail/detail.json
git add miniprogram/pages/detail/detail.js
git add miniprogram/pages/detail/detail.wxml
git add miniprogram/pages/detail/detail.wxss
git commit -m "feat: 详情页改为 web-view + cover-view 自定义导航栏"
```

---

## Chunk 4: 云开发控制台操作（手动）

### Task 7: 在微信云开发控制台删除已部署的 fetchDetail 云函数

这一步无法自动化，需手动操作：

- [ ] **Step 1: 登录微信云开发控制台**

打开微信开发者工具 → 云开发 → 云函数 → 找到 `fetchDetail` → 点击删除

- [ ] **Step 2: 确认线上 fetchDetail 已不可调用**

在微信开发者工具控制台执行：
```js
wx.cloud.callFunction({ name: "fetchDetail", success: console.log, fail: console.error })
```
期望：调用失败（云函数不存在）

---

## 完成检查

- [ ] `cloudfunctions/fetchDetail/` 目录不存在
- [ ] 列表页点击卡片能正常跳转详情页（传参方式）
- [ ] 详情页 web-view 正常加载招标原始网页
- [ ] 自定义导航栏可见，"返回"和"浏览器"按钮功能正常
- [ ] 云开发控制台中 fetchDetail 已删除
