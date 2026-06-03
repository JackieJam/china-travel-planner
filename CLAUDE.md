# 全国交通旅游地图

交互式地图应用，展示全国高铁线路、城市地铁网络与著名景点。

## 技术栈

- 前端：原生 HTML/CSS/JS，单页应用
- 地图：高德地图 JS API 2.0
- 数据：JSON 文件（高铁/地铁/景点分层存储）
- 数据爬取：Python 3 + requests
- 部署：静态文件，可部署到任意 Web 服务器

## 目录结构

```
├── index.html          # 主页面
├── css/style.css       # 样式
├── js/app.js           # 主逻辑
├── data/
│   ├── cities.json     # 城市列表及坐标
│   ├── hsr.json        # 高铁线路数据
│   ├── metro.json      # 地铁线路数据
│   └── spots.json      # 景点数据
├── tools/
│   └── collect_data.py # 数据爬取脚本
└── CLAUDE.md           # 本文件
```

## 数据约定

- 坐标统一使用 GCJ-02（高德坐标系）
- GeoJSON 格式存储线路和点位
- 每条高铁线路有独立 color 字段用于地图着色
- 地铁数据按城市组织，每条线路包含完整站点序列
- 景点数据包含分类标签（自然/历史/文化/现代）

## 开发规范

- CSS 使用 CSS 变量管理主题色
- JS 使用 ES6+ 语法，模块化组织
- 数据文件修改后需刷新页面验证
- 高德 API Key 不入代码，通过 URL 参数或 config.js 配置

## 本地运行

```bash
python3 -m http.server 8080
# 访问 http://localhost:8080
```
