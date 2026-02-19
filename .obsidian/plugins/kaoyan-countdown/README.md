# Kaoyan Countdown

An [Obsidian](https://obsidian.md) plugin that displays a countdown to the **Chinese Postgraduate Entrance Exam (考研)** with phase tracking, daily plans, and a focus timer.

[中文说明](#中文说明)

## Features

- **Countdown** — days remaining until exam day, always visible
- **Day view** — today's study tasks parsed from your daily plan file, with checkboxes that write back to the file
- **Week view** — Mon–Sun overview with per-day completion percentages
- **Phase view** — current study phase progress, subject time allocation, monthly milestones, and a global task checklist
- **Focus timer** — Pomodoro, Scientific Focus (90 min + micro-pauses), and Stopwatch modes with daily stats tracking

<!-- ![screenshot](docs/screenshot.png) -->

## Installation

### From Community Plugins (recommended)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for **Kaoyan Countdown**
3. Click Install, then Enable

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/wendou-chen/kaoyan-countdown/releases/latest)
2. Create folder `.obsidian/plugins/kaoyan-countdown/` in your vault
3. Copy the three files into that folder
4. Reload Obsidian and enable the plugin

## Configuration

Open Settings → Kaoyan Countdown to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| 考试日期 | Next Dec 3rd Saturday | Exam date (YYYY-MM-DD) |
| 计划文件夹 | `考研计划` | Folder containing daily plan files |
| 显示时间分配 | On | Show subject allocation in phase view |
| 番茄钟时长 | 25 min | Pomodoro focus duration |
| 短/长休息 | 5 / 15 min | Break durations |
## Daily Plan File Format

The plugin reads markdown files from your plan folder. Files should be named with a date prefix, e.g. `2026-03-01 周日计划.md`.

Supported task formats:

**Table rows:**
```markdown
| 时间 | 科目 | 内容 | 状态 |
|------|------|------|------|
| 08:00-10:00 | 数学 | 高数第三章 | ⬜ |
| 10:00-12:00 | 英语 | 阅读训练 | ✅ |
```

**Checklist rows:**
```markdown
- [ ] 08:00-10:00 | 数学 | 高数第三章
- [x] 10:00-12:00 | 英语 | 阅读训练
```

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

[MIT](LICENSE)

---

## 中文说明

一款 Obsidian 插件，为考研学生提供倒计时、阶段规划、每日任务和专注计时功能。

### 功能

- **倒计时** — 距离考试还有多少天
- **日视图** — 从每日计划文件解析任务，支持勾选完成
- **周视图** — 一周七天完成率总览
- **阶段视图** — 当前复习阶段进度、科目时间分配、月度里程碑
- **专注模式** — 番茄钟 / 科学专注 (90分钟+微休息) / 正计时，含每日统计

### 安装

在 Obsidian 社区插件中搜索 **Kaoyan Countdown** 即可安装。

### 设置

插件设置中可配置考试日期、计划文件夹路径、番茄钟参数等。
