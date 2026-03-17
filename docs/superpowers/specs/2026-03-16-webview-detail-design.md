# 设计文档：详情页 web-view 改造

**日期：** 2026-03-16
**状态：** ~~已确认~~ **已废弃（2026-03-17）**

> ⚠️ 此设计已被放弃。原因：政府网站域名无法添加至微信小程序业务域名白名单，`<web-view>` 方案在真机上无法使用。
>
> 当前实现方案：云函数（`getDetail`）实时抓取 HTML + 原生页面渲染。
> 参见 `docs/superpowers/specs/2026-03-17-detail-page-cloudfunction-rendering.md`。

---

---

## 背景

当前详情页（`miniprogram/pages/detail/detail`）通过云函数 `getData?action=detail` 从数据库加载完整记录，在小程序内渲染 HTML 内容。`fetchDetail` 云函数负责爬取采购公告详情页的 HTML 并写回数据库。

**目标：**
- 移除 `fetchDetail` 云函数（删除整个目录）
- 详情页不再展示解析后的 HTML 内容，改为直接使用 `<web-view>` 加载原始页面 URL
- 设计自定义顶部导航栏，提供"返回"和"用浏览器打开（复制链接）"两个操作按钮

---

## 架构

采用**方案 B（URL 直接传参）**：

- 列表记录本身已包含 `url` 字段，列表页跳转时将 `url` 和 `title` 通过 URL 参数传递
- 详情页从 `onLoad options` 读取参数，**零云函数调用**，页面打开即加载 web-view
- `api.getDetail` 调用完全移除

---

## 关键约束

`<web-view>` 组件**自动铺满整个小程序页面**，普通 `<view>` 无法覆盖其上方。自定义导航栏必须使用 `<cover-view>` 组件，该组件专为覆盖原生组件（包括 web-view）而设计。

---

## 各文件变更

### 1. `miniprogram/pages/index/index.js`

`onCardTap` 改为从自定义组件 `triggerEvent` 传递的 `e.detail.item` 读取数据（现有组件已通过 `triggerEvent("cardtap", { item: ... })` 传递完整记录，无需修改 `index.wxml`）：

```js
onCardTap: function(e) {
  var item = e.detail.item;
  wx.navigateTo({
    url: "/pages/detail/detail?url=" + encodeURIComponent(item.url || "") +
         "&title=" + encodeURIComponent(item.title || "招标详情")
  });
}
```

### 2. `miniprogram/pages/detail/detail.json`

```json
{
  "usingComponents": {},
  "navigationStyle": "custom"
}
```

### 3. `miniprogram/pages/detail/detail.js`

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

### 4. `miniprogram/pages/detail/detail.wxml`

`<cover-view>` 可覆盖在 `<web-view>` 之上，是微信小程序处理此场景的官方方案：

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

### 5. `miniprogram/pages/detail/detail.wxss`

完整替换（旧有 `.dt-*` 样式全部移除）：

```css
/* cover-view 导航栏 */
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

/* 错误态 */
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

### 6. `cloudfunctions/fetchDetail/`（删除）

整个目录删除，包含 `index.js`、`config.json` 等所有文件。

**附加操作：**
- 检查 `project.config.json` 中是否有 `fetchDetail` 配置项，如有则一并删除
- 在**微信云开发控制台**手动删除已部署的 `fetchDetail` 云函数，防止旧版本仍在线上运行

---

## 注意事项

- `<web-view>` 在**个人类型小程序**中不可用，需非个人账号（企业/政府/媒体等）
- `<cover-view>` 内部只支持 `<cover-view>`、`<cover-image>` 子组件，以及通过 `<text>` 渲染文字；不支持常规 `<view>` 嵌套
- `<web-view>` 加载的域名需要在微信公众平台"业务域名"白名单中配置（ccgp.gov.cn、ggzyjy.sc.gov.cn）
- "用浏览器打开"功能：由于微信小程序安全策略不允许直接跳转系统浏览器，采用复制链接到剪贴板并弹出提示的方式作为正式实现

---

## 不变更范围

- `cloudfunctions/getData/index.js` 中的 `handleDetail` 函数保留
- `miniprogram/utils/api.js` 中的 `getDetail` 函数保留（不再调用但不删除）
- `miniprogram/pages/index/index.wxml` 无需修改（`e.detail.item` 来自组件 triggerEvent）
- 列表页其他逻辑、统计页、设置页均不受影响
