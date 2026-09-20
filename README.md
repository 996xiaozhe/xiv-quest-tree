<img src="public/favicon.svg" width="72" height="72" alt="" align="right" />

# FFXIV Quest Tree · 最终幻想14 任务树

把《最终幻想 XIV》的全部任务及其前置 / 后续关系画成一张可交互的依赖图。

## 功能

- **依赖图** —— 滚轮缩放、拖拽平移、双击聚焦；选中任务会高亮通往它的整条前置链，右键可只看它的前置或后续任务。
- **四级筛选** —— 资料片 → 任务大类 → 主分类 → 子分类，带数量统计与快捷预设。
- **三语搜索** —— 中 / 英 / 日模糊匹配，`↑↓` + `Enter` 操作；`Ctrl+K` / `⌘K` / `/` 随时聚焦搜索框，并记住最近查看的 5 个任务。
- **任务详情** —— 等级、版本、地区、分类、职业限制、开始 / 结束 NPC、奖励、Lodestone 链接与各语言名称对照。
- **可分享的深链** —— `/pre/<id>`、`/post/<id>` 直接分享某个任务的前置或后续视图。
- **点坐标看地图** —— 详情里的「地区 + 坐标」在浮窗中打开沙之家互动地图并插旗，浮窗可拖动、可自由改大小。
- **两套主题** —— 夜间鎏金与日间两套扁平配色，右上角一键切换。

## 快速开始

需要 Node 20.19+ 或 22.12+。仓库里已经包含构建好的数据集，不需要先抓数据。

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产出 dist/
```

检查改动：`npm run typecheck`、`npm test`（数据 / 筛选 / 搜索 / 布局 / 渲染断言）、`npm run test:dom`（在 jsdom 里跑真实构建产物）。

## 数据

任务数据由国服客户端数据表、[XIVAPI](https://v2.xivapi.com/) 与 [Lodestone](https://eu.finalfantasyxiv.com/lodestone/playguide/db/quest/) 合并而成，并用[沙之家文本库](https://strings.ffcafe.cn/)交叉校验；互动地图与地图数据来自[沙之家](https://github.com/thewakingsands)。需要重新抓取时：

```bash
npm run data:all   # 下载数据表 → 拉取多语言与坐标 → 重建 public/data/quests.json
```

## 部署

纯静态站点，直接部署到 Vercel（框架选 Vite）或任何静态托管即可，无需环境变量。

## 许可

代码以 [MIT](LICENSE) 发布。《FINAL FANTASY XIV》的文本、图像与数据版权归 SQUARE ENIX CO., LTD. 所有；本项目为非官方粉丝作品，与 SQUARE ENIX 无关联。
