# 小程序内打开第三方网页的可行方案

## 背景

微信小程序的 `<web-view>` 只能加载**业务域名白名单**内的网页。政府网站（如 ggzyjy.sc.gov.cn、ccgp.gov.cn）无法在其根目录放置校验文件，因此无法直接配置为业务域名。

## 方案对比

| 方案 | 体验 | 可行性 | 说明 |
|------|------|--------|------|
| **wx.miniapp.openUrl** | 最佳（直接打开系统浏览器） | ❌ 不可用 | 仅支持多端应用 App 模式，普通小程序内会返回 `access denied` |
| **web-view + 业务域名** | 最佳（小程序内嵌） | ❌ 不可控域名无法配置 | 需在目标网站根目录放置校验文件 |
| **Nginx 反向代理** | 最佳（小程序内嵌） | ✅ 可行 | 用自有域名代理目标网站，将自有域名加入业务域名 |
| **复制链接** | 一般 | ✅ 当前方案 | 无服务器时的唯一选择 |

## 推荐：Nginx 反向代理方案

若你有**自有域名 + 服务器**（或云托管），可通过反向代理实现小程序内 web-view 直接打开第三方网页。

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

以代理 `ggzyjy.sc.gov.cn` 为例：

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
        proxy_set_header Accept-Encoding "";  # 便于 sub_filter 处理 gzip
        sub_filter 'ggzyjy.sc.gov.cn' 'proxy.yourdomain.com';
        sub_filter_once off;
    }

    # 代理中国政府采购网（可选）
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

### 小程序侧改造

1. **URL 转换**：列表页跳转时，将原始 URL 转为代理 URL

```js
// 例如原始: https://ggzyjy.sc.gov.cn/jyxx/002002/...
// 转换后:   https://proxy.yourdomain.com/ggzy/jyxx/002002/...
function toProxyUrl(url) {
  if (url.startsWith("https://ggzyjy.sc.gov.cn/")) {
    return url.replace("https://ggzyjy.sc.gov.cn/", "https://proxy.yourdomain.com/ggzy/");
  }
  if (url.startsWith("https://www.ccgp.gov.cn/")) {
    return url.replace("https://www.ccgp.gov.cn/", "https://proxy.yourdomain.com/ccgp/");
  }
  return url;  // 无法代理的保持原样，走复制链接
}
```

2. **恢复详情页**：使用 web-view 加载代理后的 URL

### 注意事项

- **sub_filter 局限**：政府网站结构复杂，页面内可能有大量绝对路径、JS 动态加载的资源，`sub_filter` 可能无法完全替换，部分资源可能 404
- **反爬与合规**：代理政府网站需注意合规性，建议仅用于个人学习或已获授权场景
- **性能**：代理会增加一层转发，首次加载可能略慢

---

## 当前方案：复制链接

无服务器时，采用「点击即复制 + Toast 提示」：

- 点击卡片 → 自动复制链接 → Toast「已复制，在浏览器粘贴打开」
- 用户打开系统浏览器 → 地址栏粘贴 → 访问

这是微信生态下对不可控第三方链接的通用做法。
