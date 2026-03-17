# 小程序内打开第三方网页的可行方案

## 背景

微信小程序的 `<web-view>` 只能加载**业务域名白名单**内的网页。政府网站（如 ggzyjy.sc.gov.cn、ccgp.gov.cn）无法在其根目录放置校验文件，因此无法直接配置为业务域名。

## 方案对比

| 方案 | 体验 | 可行性 | 说明 |
|------|------|--------|------|
| **wx.miniapp.openUrl** | 最佳（直接打开系统浏览器） | ❌ 不可用 | 仅支持多端应用 App 模式，普通小程序内会返回 `access denied` |
| **web-view + 业务域名** | 最佳（小程序内嵌） | ❌ 不可控域名无法配置 | 需在目标网站根目录放置校验文件 |
| **Nginx 反向代理** | 最佳（小程序内嵌） | ✅ 可行，但需服务器 | 用自有域名代理目标网站，将自有域名加入业务域名 |
| **☑ 云函数抓取 + 原生渲染** | 良好（小程序内展示） | ✅ **已实现（当前方案）** | 云函数实时抓取 HTML，cheerio 解析正文，原生页面展示 |
| **复制链接** | 一般 | ✅ 旧方案 | 已替换，仅作错误降级兜底 |

---

## 当前方案：云函数抓取 + 原生渲染

### 原理

```
用户点击卡片
  → setStorageSync 缓存 item 数据
  → navigateTo /pages/detail/detail
  → 详情页 onLoad：读取 item，调用 getDetail 云函数
  → 云函数：axios 抓取原始 URL → cheerio 解析正文段落和附件
  → 返回结构化数据给小程序
  → 原生页面展示标题 / 元信息 / 正文段落 / 附件列表
```

### 优势

- **零额外费用**：不需要服务器或域名，复用微信云函数
- **无域名限制**：axios 在云函数（Node.js 环境）中不受业务域名白名单限制
- **完全原生体验**：正文段落、附件在小程序内直接展示，支持长按复制
- **附件可直接打开**：PDF/DOC 文件通过 `wx.downloadFile` + `wx.openDocument` 在微信内打开

### 相关文件

| 文件 | 说明 |
|------|------|
| `cloudfunctions/getDetail/index.js` | 云函数主体：抓取 HTML、解析段落和附件 |
| `cloudfunctions/getDetail/package.json` | 依赖：axios + cheerio + iconv-lite |
| `miniprogram/pages/detail/detail.js` | 详情页逻辑：调用云函数、附件下载 |
| `miniprogram/pages/detail/detail.wxml` | 详情页布局：元信息卡片 / 段落 / 附件列表 |
| `miniprogram/pages/detail/detail.wxss` | 详情页样式 |
| `miniprogram/utils/api.js` | `fetchPageDetail(url)` 封装 |
| `miniprogram/pages/index/index.js` | `onCardTap` 改为 setStorage + navigateTo |

### 降级策略

| 情况 | 表现 |
|------|------|
| 正常加载 | 展示解析后的正文段落，可长按复制 |
| 加载失败 / 超时 | 显示"重新加载" + "复制链接"两个按钮 |
| 正文解析为空 | 提示"未能解析到正文内容" + "复制链接在浏览器查看" |
| 任意时刻 | 顶部"复制原始链接"按钮始终可用 |

### HTML 解析逻辑

云函数使用分优先级的选择器策略，取文本量最大的匹配元素作为正文区域：

**CCGP（中国政府采购网）：**
`.vT_detail_main` → `#center_qp` → `.infoContent`

**四川省公共资源交易信息网：**
`.details-content` → `.detail-content` → `#detail_content`

**通用兜底：**
`.TRS_Editor` → `#zoom` → `.article-content` → `#content` → `article` → `body`

### 注意事项

- 部分政府网站页面加载较慢，云函数调用超时设置为 20 秒（前端）、默认云函数 3 秒（需在控制台调整）
- 若目标页面使用 GBK 编码，云函数通过检测 `charset` meta 标签自动用 iconv-lite 解码
- **上线前需在云开发控制台将 `getDetail` 云函数的超时时间调整为 15~20 秒**

---

## 备选方案：Nginx 反向代理

若有**自有备案 HTTPS 域名 + 服务器**，可通过反向代理实现 `<web-view>` 内嵌展示，体验更接近原生浏览器。

### 原理

```
用户点击 → 小程序请求 https://proxy.yourdomain.com/ggzy/xxx
         → Nginx 代理到 https://ggzyjy.sc.gov.cn/xxx
         → 返回内容给 web-view 展示
```

### 前置条件

- 自有已备案 HTTPS 域名（如 `proxy.yourdomain.com`）
- 服务器或云托管（支持 Nginx 反向代理）
- 将该域名配置为小程序的业务域名

### Nginx 配置示例

```nginx
server {
    listen 443 ssl http2;
    server_name proxy.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 代理四川省公共资源交易网
    location /ggzy/ {
        proxy_pass https://ggzyjy.sc.gov.cn/;
        proxy_set_header Host ggzyjy.sc.gov.cn;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_server_name on;
        proxy_set_header Accept-Encoding "";
        sub_filter 'ggzyjy.sc.gov.cn' 'proxy.yourdomain.com';
        sub_filter_once off;
    }

    # 代理中国政府采购网
    location /ccgp/ {
        proxy_pass https://www.ccgp.gov.cn/;
        proxy_set_header Host www.ccgp.gov.cn;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_server_name on;
        proxy_set_header Accept-Encoding "";
        sub_filter 'www.ccgp.gov.cn' 'proxy.yourdomain.com';
        sub_filter_once off;
    }
}
```

### 注意事项

- **sub_filter 局限**：政府网站结构复杂，JS 动态加载的资源路径可能无法完全替换
- **反爬与合规**：代理政府网站需注意合规性，建议仅用于个人学习或已获授权场景
- **性能**：代理会增加一层转发，首次加载可能略慢
