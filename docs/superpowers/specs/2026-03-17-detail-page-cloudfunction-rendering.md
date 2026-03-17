# 设计文档：采购详情页——云函数抓取 + 原生渲染

**日期：** 2026-03-17
**状态：** 已实现

---

## 背景

微信小程序 `<web-view>` 需要业务域名白名单，政府采购网站无法配置，导致之前的 web-view 方案无法在真机使用。本方案绕过域名限制：由云函数（Node.js 环境不受业务域名约束）实时抓取目标页面 HTML，解析后以原生组件渲染。

---

## 架构

```
列表页 onCardTap
  → setStorageSync("detail_item", item)
  → navigateTo /pages/detail/detail

详情页 onLoad
  → getStorageSync("detail_item")
  → wx.cloud.callFunction("getDetail", { url })

云函数 getDetail
  → axios(url, { responseType: "arraybuffer" })
  → 检测 charset（UTF-8 / GBK）
  → cheerio 解析正文段落 + 附件链接
  → 返回 { paragraphs: [...], attachments: [...] }

详情页渲染
  → 元信息卡片（标题 / 时间 / 采购人 / 代理机构 / 地区）
  → 正文段落列表（heading / table-row / paragraph 三种类型）
  → 附件列表（PDF/DOC 可直接在微信打开）
```

---

## 文件清单

| 文件 | 角色 |
|------|------|
| `cloudfunctions/getDetail/index.js` | 云函数：抓取 + 解析 |
| `cloudfunctions/getDetail/package.json` | 依赖：axios / cheerio / iconv-lite |
| `miniprogram/pages/detail/detail.js` | 页面逻辑 |
| `miniprogram/pages/detail/detail.json` | 页面配置（默认导航栏） |
| `miniprogram/pages/detail/detail.wxml` | 页面结构 |
| `miniprogram/pages/detail/detail.wxss` | 页面样式 |
| `miniprogram/utils/api.js` | `fetchPageDetail(url)` 封装（调用 getDetail 云函数） |
| `miniprogram/pages/index/index.js` | `onCardTap` 改为 setStorage + navigateTo |
| `miniprogram/app.json` | 新增 `pages/detail/detail` 路由 |

---

## 云函数解析逻辑

### 编码检测

```
responseType: "arraybuffer"
→ 扫描前 2000 字节提取 charset meta 标签
→ gbk / gb2312 / gb18030 → iconv.decode(buffer, "gbk")
→ 其他 → buffer.toString("utf-8")
```

### 内容区域定位（选择器优先级）

| 优先级 | 选择器 | 目标站点 |
|--------|--------|---------|
| 1 | `.vT_detail_main`, `#center_qp`, `.infoContent` | ccgp.gov.cn |
| 2 | `.details-content`, `.detail-content`, `#detail_content` | ggzyjy.sc.gov.cn |
| 3 | `.TRS_Editor`, `#zoom`, `#vContent`, `.article-content` | 通用 CMS |
| 4 | `.content`, `#content`, `article` | 通用兜底 |
| 5 | `body`（移除干扰元素后） | 最终兜底 |

取所有匹配中**文本量最大**的元素。

### 段落提取（三类型）

- `heading`：`h1~h6`
- `table-row`：`tr`（多列合并为 `cell1  cell2` 格式）
- `paragraph`：`p`（跳过含块级子元素的容器），不足 3 段时补充叶子 `div/li/span`

### 附件提取

识别条件（满足之一）：
- `href` 后缀匹配 `.pdf/.doc/.docx/.xls/.xlsx/.zip/.rar/.7z/.txt`
- 链接文字包含"附件"或"下载"

相对路径自动补全为绝对 URL。

---

## 详情页 UI

### 区域结构

```
┌──────────────────────────────┐
│ [元信息卡片]                 │
│  标题（大字）                │
│  公告类型 tag  发布日期      │
│  采购人 / 代理机构 / 地区    │
│  复制原始链接（蓝色小按钮）  │
├──────────────────────────────┤
│ [加载中] / [错误] / [正文]   │
│  正文段落（支持长按复制）    │
├──────────────────────────────┤
│ [附件列表]（可选）           │
│  PDF/DOC → wx.openDocument  │
│  其他     → 复制链接         │
└──────────────────────────────┘
```

### 降级策略

| 情况 | UI 响应 |
|------|---------|
| 云函数成功 | 展示正文段落 |
| 云函数超时/失败 | 错误卡片 + "重新加载" + "复制链接" |
| 段落解析为空 | "未能解析到正文" + "复制链接在浏览器查看" |
| 随时 | 元信息卡片顶部"复制原始链接"始终可用 |

---

## 运维注意事项

1. **云函数超时**：`getDetail` 默认超时 3 秒不够用，需在微信云开发控制台将其调整为 **15~20 秒**。
2. **部署**：在微信开发者工具中右键 `cloudfunctions/getDetail` → "上传并部署：云端安装依赖"。
3. **选择器维护**：若政府网站改版导致内容区域无法识别，在 `getDetail/index.js` 的 `CONTENT_SELECTORS` 数组中补充新选择器即可，无需修改小程序端代码。

---

## 不变更范围

- `cloudfunctions/getData/index.js` 中的 `handleDetail` 函数保留（数据库详情查询，备用）
- `miniprogram/utils/api.js` 中的 `getDetail`（数据库查询版本）保留，不影响新增的 `fetchPageDetail`
- 列表页结构、统计页、设置页不受影响
