按照以下要求修改 Obsidian 插件实现自动记录学习进度功能：

背景：
插件位于 .obsidian/plugins/kaoyan-countdown/
已有手动保存书签功能（save-study-progress 命令），现在要新增自动轮询功能：
每隔 8 秒检测当前打开的文件页面状态，如果页码/位置发生变化则自动静默更新书签，无需用户手动触发。

任务1：修改 src/main.ts，新增自动轮询逻辑

在 onload() 方法末尾，在 app.workspace.onLayoutReady 注册之后，追加以下代码：

    // 自动学习进度追踪：每 8 秒轮询当前文件状态
    this.registerInterval(
      window.setInterval(() => this.autoTrackProgress(), 8000)
    );

在 saveCurrentProgress() 方法之后，追加以下方法：

  async autoTrackProgress() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) return;
    const view = activeLeaf.view;
    if (!(view instanceof FileView) || !view.file) return;

    // 只追踪 PDF 文件（扩展名为 .pdf）
    if (!view.file.extension || view.file.extension.toLowerCase() !== 'pdf') return;

    const state = view.getState();
    const filePath = view.file.path;

    // 与已存书签比较，如果状态相同则跳过
    const existing = (this.settings.bookmarks || []).find((b: any) => b.filePath === filePath);
    if (existing && JSON.stringify(existing.state) === JSON.stringify(state)) return;

    // 状态已变化，静默更新书签（不弹 Notice，不调 refreshViews 避免频繁渲染）
    const bookmark = {
      filePath,
      state,
      label: view.file.basename,
      timestamp: Date.now(),
    };

    let bookmarks = this.settings.bookmarks || [];
    bookmarks = bookmarks.filter((b: any) => b.filePath !== filePath);
    bookmarks.unshift(bookmark);
    if (bookmarks.length > 5) bookmarks = bookmarks.slice(0, 5);

    this.settings.bookmarks = bookmarks;
    await this.saveSettings();
    // 仅刷新视图（不弹通知），让面板书签按钮保持最新
    this.refreshViews();
  }

任务2：修改 src/CountdownView.ts，在书签按钮上显示"自动"标签

在 renderBookmarks 方法中，将 btn.createEl('span', { cls: 'kc-bookmark-time', text: timeLabel }); 这一行之后追加：

    // 如果是自动保存的（timestamp 在最近60秒内），展示"自动保存"小标签
    const isAuto = (Date.now() - recent.timestamp) < 60000;
    if (isAuto) {
      btn.createEl('span', { cls: 'kc-bookmark-auto', text: '● 自动' });
    }

任务3：修改 styles.css，追加 .kc-bookmark-auto 样式

在文件末尾追加：
.kc-bookmark-auto {
  font-size: 10px;
  color: #52c41a;
  white-space: nowrap;
}

任务4：在插件目录执行编译
cd .obsidian/plugins/kaoyan-countdown && npm run build

验证：
- npm run build 无报错
- main.js 修改时间为今天（2026-02-19）
- main.js 大小大于 30000 字节
