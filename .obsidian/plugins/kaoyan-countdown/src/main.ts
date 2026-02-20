import { Plugin, WorkspaceLeaf, Notice, MarkdownView, FileView } from 'obsidian';
import { CountdownView, VIEW_TYPE_COUNTDOWN } from './CountdownView';
import { KaoyanSettings, DEFAULT_SETTINGS, DEFAULT_FOCUS_SETTINGS, DEFAULT_FOCUS_STATS, DEFAULT_AI_SETTINGS } from './types';
import { KaoyanSettingTab } from './settingsTab';

export default class KaoyanCountdownPlugin extends Plugin {
  settings: KaoyanSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_COUNTDOWN,
      (leaf) => new CountdownView(leaf, this)
    );

    this.addSettingTab(new KaoyanSettingTab(this.app, this));

    this.addRibbonIcon('clock', '考研倒计时', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-kaoyan-countdown',
      name: '打开考研倒计时',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'save-study-progress',
      name: '记录当前学习进度',
      callback: () => this.saveCurrentProgress(),
    });

    this.app.workspace.onLayoutReady(() => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_COUNTDOWN).length === 0) {
        this.activateView();
      }
    });

    // 自动学习进度追踪：每 8 秒静默记录 PDF 当前页
    this.registerInterval(
      window.setInterval(() => this.autoTrackProgress(), 8000)
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_COUNTDOWN);
  }

  async activateView() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_COUNTDOWN);

    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_COUNTDOWN, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  /** Re-render all open countdown views (called after settings change). */
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COUNTDOWN)) {
      const view = leaf.view;
      if (view instanceof CountdownView) {
        view.refresh();
      }
    }
  }

  async saveCurrentProgress() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) {
      new Notice('没有活动的视图');
      return;
    }

    const view = activeLeaf.view;
    if (!(view instanceof FileView) || !view.file) {
      new Notice('当前视图不是文件视图');
      return;
    }

    // Capture state (e.g. scroll position, PDF page)
    const state = view.getState();
    const filePath = view.file.path;
    const timestamp = Date.now();

    const bookmark = {
      filePath,
      state,
      label: view.file.basename,
      timestamp,
    };

    // Keep only the last 5 bookmarks, avoid duplicates at top
    let bookmarks = this.settings.bookmarks || [];
    // Remove existing bookmark for same file
    bookmarks = bookmarks.filter(b => b.filePath !== filePath);
    // Add to top
    bookmarks.unshift(bookmark);
    // Limit to 5
    if (bookmarks.length > 5) bookmarks = bookmarks.slice(0, 5);

    this.settings.bookmarks = bookmarks;
    await this.saveSettings();
    this.refreshViews();

    new Notice(`已记录学习进度: ${view.file.basename}`);
  }

  async autoTrackProgress() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) return;
    const view = activeLeaf.view;
    if (!(view instanceof FileView) || !view.file) return;

    // 只追踪 PDF 文件
    if (view.file.extension?.toLowerCase() !== 'pdf') return;

    const state = view.getState();
    const filePath = view.file.path;

    // 与已存书签比较，状态未变则跳过
    const existing = (this.settings.bookmarks || []).find((b: any) => b.filePath === filePath);
    if (existing && JSON.stringify(existing.state) === JSON.stringify(state)) return;

    // 状态已变，静默更新
    const bookmark = { filePath, state, label: view.file.basename, timestamp: Date.now() };
    let bookmarks = this.settings.bookmarks || [];
    bookmarks = bookmarks.filter((b: any) => b.filePath !== filePath);
    bookmarks.unshift(bookmark);
    if (bookmarks.length > 5) bookmarks = bookmarks.slice(0, 5);
    this.settings.bookmarks = bookmarks;
    await this.saveSettings();
    this.refreshViews();
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.focus = Object.assign({}, DEFAULT_FOCUS_SETTINGS, data.focus);
    this.settings.focusStats = Object.assign({}, DEFAULT_FOCUS_STATS, data.focusStats);
    this.settings.ai = Object.assign({}, DEFAULT_AI_SETTINGS, data.ai);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
