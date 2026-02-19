import { PluginSettingTab, Setting, App } from 'obsidian';
import type KaoyanCountdownPlugin from './main';

export class KaoyanSettingTab extends PluginSettingTab {
  plugin: KaoyanCountdownPlugin;

  constructor(app: App, plugin: KaoyanCountdownPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '考研倒计时 设置' });

    // ── 基本设置 ──
    new Setting(containerEl)
      .setName('考试日期')
      .setDesc('格式 YYYY-MM-DD，如 2026-12-19')
      .addText(text => text
        .setPlaceholder('2026-12-19')
        .setValue(this.plugin.settings.examDate)
        .onChange(async (value) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            this.plugin.settings.examDate = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          }
        }));

    new Setting(containerEl)
      .setName('计划文件夹')
      .setDesc('存放每日计划文件的文件夹路径')
      .addText(text => text
        .setPlaceholder('考研计划')
        .setValue(this.plugin.settings.planFolder)
        .onChange(async (value) => {
          this.plugin.settings.planFolder = value.trim() || '考研计划';
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    new Setting(containerEl)
      .setName('显示时间分配')
      .setDesc('在阶段视图中显示各科目时间分配比例')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showAllocation)
        .onChange(async (value) => {
          this.plugin.settings.showAllocation = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));
    // ── 专注模式设置 ──
    containerEl.createEl('h3', { text: '专注模式' });

    new Setting(containerEl)
      .setName('番茄钟时长 (分钟)')
      .addSlider(slider => slider
        .setLimits(15, 60, 5)
        .setValue(this.plugin.settings.focus.pomodoroDurationMin)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.focus.pomodoroDurationMin = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('短休息 (分钟)')
      .addSlider(slider => slider
        .setLimits(1, 15, 1)
        .setValue(this.plugin.settings.focus.shortBreakMin)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.focus.shortBreakMin = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('长休息 (分钟)')
      .addSlider(slider => slider
        .setLimits(10, 30, 5)
        .setValue(this.plugin.settings.focus.longBreakMin)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.focus.longBreakMin = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('长休息间隔 (番茄数)')
      .addSlider(slider => slider
        .setLimits(2, 6, 1)
        .setValue(this.plugin.settings.focus.longBreakInterval)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.focus.longBreakInterval = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('科学专注时长 (分钟)')
      .addSlider(slider => slider
        .setLimits(60, 120, 10)
        .setValue(this.plugin.settings.focus.scientificDurationMin)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.focus.scientificDurationMin = value;
          await this.plugin.saveSettings();
        }));
  }
}
