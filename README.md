# InfoCrawler

本小程序致力于为用户提供便捷、高效的公共信息浏览与订阅服务。通过对各类政府公开渠道中已依法发布的采购及相关信息进行整理与归纳，帮助用户更加轻松地获取分散在不同平台上的公开内容。

---

## 功能特性

- **全量抓取**：每天定时自动抓取公开网站的所有采购公告，确保数据完整性
- **智能匹配**：抓取入库时用所有用户的合并关键字打标签，方便前端快速筛选展示
- **扁平关键字**：用户管理抓取关键字，每个关键字即独立分类，自动同步为首页筛选标签
- **精准推送**：按每个用户自己的关键字独立过滤，只推送该用户真正关注的采购信息（PushPlus）
- **详情查看**：点击卡片复制链接，提示用户在手机浏览器中粘贴打开
- **数据统计**：7 天趋势图、来源分布、关键词排行、采购类型分布、多分类占比
- **用户隔离**：所有个人配置按 openid 隔离存储，多用户互不干扰
- **零成本运维**：基于微信云开发免费额度，无需额外服务器

---

## 技术栈

- 微信小程序原生框架（WXML + WXSS + JavaScript）
- 微信云开发（云函数 + 云数据库）
- Node.js + axios + cheerio
- PushPlus 微信推送

---

## 项目结构

```
InfoCrawler/
├── miniprogram/                    # 小程序前端
│   ├── pages/
│   │   ├── index/                  # 首页：采购信息列表 + 分类标签 + 统计卡片
│   │   ├── stats/                  # 数据统计：图表分析面板
│   │   ├── filter/                 # 高级筛选
│   │   └── settings/               # 设置：来源 / 关键字 / 自动抓取 / 推送
│   ├── components/
│   │   └── procurement-card/       # 采购信息卡片组件
│   ├── custom-tab-bar/             # 自定义底部导航栏
│   └── utils/
│       ├── api.js                  # 云函数调用封装
│       ├── config.js               # 本地缓存 + 默认值
│       └── util.js                 # 通用工具函数
├── cloudfunctions/
│   ├── crawl/                      # 抓取云函数（定时 + 手动）
│   │   ├── crawlers/ccgp.js        # 采购网爬虫
│   │   ├── crawlers/sichuan-ggzy.js# 公共资源交易网爬虫
│   │   ├── config/sources.js       # 来源静态配置
│   │   ├── config/keywords.js      # 默认关键字
│   │   └── utils/notifier.js       # PushPlus 推送
│   ├── getData/                    # 数据查询 + 用户配置读写
│   └── clean/                      # 定期清理过期数据
└── project.config.json
```

---

## 云函数说明

### `crawl`

**触发：** 每天 06:00 定时 + 小程序手动触发

**定时策略：**
- 系统固定每天 06:00 执行（Cron: `0 0 6 * * * *`）
- 运行时读取用户 `crawl_schedule` 配置（`enabled` / `dayType`）
- `dayType`：`all`（每天）、`workday`（仅工作日）、`weekend`（仅周末）
- 所有用户均禁用或今日不满足任何用户的 dayType，则跳过本次执行

**抓取流程：**
1. 读取全部用户配置（来源、关键字）
2. 聚合所有用户启用的来源（union）
3. 对每个来源调用 `detectStartDate` 确定起始日期
   - DB 无数据：默认最近 7 天
   - DB 有数据：从存量最新 `publishDate` 开始
4. 逐页抓取，动态读取总页数（默认上限 15 页，约 52s）
5. URL 去重后入库，打 `isChemical` / `matchedKeywords` 标签
6. 有命中时按各用户关键字过滤后分别 PushPlus 推送
7. 记录抓取日志（`crawl_log`）

### `getData`

多 action 路由的统一云函数：

| action | 说明 |
|--------|------|
| `list` | 分页查询采购列表（来源、分类、关键字、日期过滤） |
| `stats` | 首页顶部统计卡片数据 |
| `analytics` | 统计页完整分析数据 |
| `getConfig` / `saveConfig` | PushPlus Token 读写 |
| `getSources` / `saveSources` | 自定义来源读写 |
| `getKeywords` / `saveKeywords` | 关键字读写 |
| `getSchedule` / `saveSchedule` | 抓取策略读写 |
| `getFollowedCategories` / `saveFollowedCategories` | 关注分类读写 |
| `getDisplaySources` / `saveDisplaySources` | 首页来源快捷栏读写 |

### `clean`

**触发：** 建议每周定时（如每周日 03:00）

**清理内容：**
1. `procurements` 中 `publishDate` 早于保留期的记录
2. `crawl_log` 中早于保留期的日志
3. 存量记录中的废弃字段（`contentHtml` / `fetchRetryCount` / `detailFetchedAt`）

**保留天数：** 取所有用户 `retention_days` 配置的最大值，默认 90 天

---

## 数据结构

### `procurements`

```json
{
  "title":          "string",
  "url":            "string（去重依据）",
  "source":         "ccgp | sichuan_ggzy",
  "sourceName":     "string",
  "publishDate":    "YYYY-MM-DD",
  "region":         "string",
  "buyer":          "string（采购人）",
  "agent":          "string（代理机构）",
  "bidType":        "string（公告类型）",
  "kw":             "string（本次搜索关键字）",
  "isChemical":     "boolean",
  "matchedKeywords":"string[]",
  "crawledAt":      "Date"
}
```

### `config`（按 openid 隔离）

| key | value 类型 | 说明 |
|-----|-----------|------|
| `pushplus_token` | string | PushPlus Token |
| `custom_sources` | `[{id, name}]` | 启用的抓取来源 |
| `display_sources` | `[{id, name}]` | 首页来源快捷栏 |
| `custom_keywords` | `{word: [word]}` | 关键字（每词独立分类格式） |
| `followed_categories` | string[] | 关注分类（与关键字 key 同步） |
| `crawl_schedule` | `{enabled, dayType}` | 自动抓取策略 |
| `retention_days` | number | 数据保留天数 |

---

## 部署步骤

### 1. 准备工作

- 注册微信小程序账号（个人类型），获取 **AppID**
- 安装微信开发者工具
- 注册 PushPlus 获取 **Token**

### 2. 导入项目

1. 微信开发者工具 → 导入项目
2. 项目目录选择 `InfoCrawler/`，填写 AppID
3. 修改 `project.config.json` 中的 `appid`

### 3. 开通云开发

微信开发者工具 → 云开发 → 开通免费基础版

### 4. 创建数据库集合

在云开发控制台 → 数据库创建以下集合，权限设置为「所有用户可读，仅创建者可读写」：

| 集合名 | 用途 |
|--------|------|
| `procurements` | 采购公告（全局共享） |
| `crawl_log` | 抓取日志（系统级） |
| `config` | 用户配置（按 openid 隔离） |

### 5. 部署云函数

右键各云函数目录 → 「上传并部署：云端安装依赖」：

| 云函数 | 超时时间 | 内存 |
|--------|----------|------|
| `crawl` | 900 秒 | 1024 MB |
| `getData` | 900 秒 | 1024 MB |
| `clean` | 900 秒 | 1024 MB |

### 6. 配置定时触发器

在云开发控制台 → 云函数中配置触发器（7 字段 Cron）：

| 云函数 | Cron | 说明 |
|--------|------|------|
| `crawl` | `0 0 6 * * * *` | 每天 06:00 |
| `clean` | `0 0 3 * * 0 *` | 每周日 03:00 |

### 7. 数据库索引

为 `procurements` 集合添加索引：

| 字段 | 说明 |
|------|------|
| `url` | 去重查询加速 |
| `publishDate` | 日期过滤 + detectStartDate |
| `source` | 来源过滤 |
| `isChemical` | 关键字命中过滤 |

### 8. 首次使用

1. 小程序「设置」页填写 PushPlus Token 并保存
2. 点击「手动抓取」触发首次抓取
3. 首页查看采购信息

---

## 常见问题

**Q: 定时触发但没有执行抓取？**
A: 检查设置页「自动抓取」是否启用，以及「运行日期」是否匹配今天。若今天是工作日但设置了「仅周末」则会跳过。

**Q: 抓取失败怎么排查？**
A: 云开发控制台 → 云函数 → crawl → 日志查看错误详情。政府网站可能临时维护或更新了页面结构。

**Q: 数据保留多久？**
A: 默认 90 天，clean 函数每周日 03:00 自动清理。可在云数据库 `config` 集合中修改 `retention_days` 记录的值。

**Q: 多人使用会冲突吗？**
A: 不会。采购数据全局共享，个人配置按 openid 隔离。抓取聚合所有用户的来源，推送按各用户关键字独立过滤后分别发送。

**Q: 如何添加新的采购来源？**
A: 在 `crawlers/` 下新建爬虫，在 `config/sources.js` 和 `index.js` 的 `CRAWLER_MAP` 中注册，在 `settings.js` 的 `_builtInSources` 中添加配置项，重新部署 crawl 函数。
