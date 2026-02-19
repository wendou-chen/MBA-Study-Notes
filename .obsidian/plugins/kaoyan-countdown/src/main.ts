import { Plugin, WorkspaceLeaf } from 'obsidian';
import { CountdownView, VIEW_TYPE_COUNTDOWN } from './CountdownView';
import { KaoyanSettings, DEFAULT_SETTINGS, DEFAULT_FOCUS_SETTINGS, DEFAULT_FOCUS_STATS } from './types';
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

    this.app.workspace.onLayoutReady(() => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_COUNTDOWN).length === 0) {
        this.activateView();
      }
    });
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

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.focus = Object.assign({}, DEFAULT_FOCUS_SETTINGS, data.focus);
    this.settings.focusStats = Object.assign({}, DEFAULT_FOCUS_STATS, data.focusStats);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
