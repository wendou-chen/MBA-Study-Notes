import { PluginSettingTab, Setting, App } from 'obsidian';
import type { AiProvider } from './types';
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

    new Setting(containerEl)
      .setName('专注锁定')
      .setDesc('专注时全屏并锁定在 Obsidian，防止切换到其他应用')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.focus.focusLock)
          .onChange(async (value) => {
            this.plugin.settings.focus.focusLock = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
      });

    // ── AI 模型配置 ──
    containerEl.createEl('h3', { text: 'AI 模型配置' });

    const providerPlaceholders: Record<AiProvider, { url: string; model: string }> = {
      anthropic: { url: 'https://api.anthropic.com', model: 'claude-opus-4-6-20250616' },
      openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o' },
      deepseek: { url: 'https://api.deepseek.com', model: 'deepseek-chat' },
    };

    new Setting(containerEl)
      .setName('AI 服务商')
      .setDesc('选择 AI API 提供商')
      .addDropdown(dropdown => dropdown
        .addOption('anthropic', 'Anthropic (Claude)')
        .addOption('openai', 'OpenAI (GPT)')
        .addOption('deepseek', 'DeepSeek')
        .setValue(this.plugin.settings.ai.provider)
        .onChange(async (value) => {
          this.plugin.settings.ai.provider = value as AiProvider;
          this.plugin.settings.ai.baseUrl = '';
          this.plugin.settings.ai.model = '';
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('留空则使用 .env 文件中的配置')
      .addText(text => {
        text.inputEl.type = 'password';
        text.setPlaceholder('sk-...')
          .setValue(this.plugin.settings.ai.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.ai.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    const currentProvider = this.plugin.settings.ai.provider;
    const ph = providerPlaceholders[currentProvider] || providerPlaceholders.anthropic;

    new Setting(containerEl)
      .setName('Base URL')
      .setDesc('自定义 API 地址（留空使用默认）')
      .addText(text => text
        .setPlaceholder(ph.url)
        .setValue(this.plugin.settings.ai.baseUrl)
        .onChange(async (value) => {
          this.plugin.settings.ai.baseUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('模型名称')
      .setDesc('留空使用默认模型')
      .addText(text => text
        .setPlaceholder(ph.model)
        .setValue(this.plugin.settings.ai.model)
        .onChange(async (value) => {
          this.plugin.settings.ai.model = value.trim();
          await this.plugin.saveSettings();
        }));
  }
}
