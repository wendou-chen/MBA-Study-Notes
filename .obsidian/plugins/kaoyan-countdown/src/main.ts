import { Plugin, WorkspaceLeaf } from 'obsidian';
import { CountdownView, VIEW_TYPE_COUNTDOWN } from './CountdownView';
import { KaoyanSettings, DEFAULT_SETTINGS } from './types';

export default class KaoyanCountdownPlugin extends Plugin {
  settings: KaoyanSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_COUNTDOWN,
      (leaf) => new CountdownView(leaf, this)
    );

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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
