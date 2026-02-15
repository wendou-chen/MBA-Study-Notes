import { ItemView, WorkspaceLeaf } from 'obsidian';
import { getDaysRemaining, getCurrentPhase, getPhaseProgress, getCurrentMonthMilestone } from './phases';
import { SUBJECT_LABELS } from './types';
import type KaoyanCountdownPlugin from './main';

export const VIEW_TYPE_COUNTDOWN = 'kaoyan-countdown-view';

export class CountdownView extends ItemView {
  plugin: KaoyanCountdownPlugin;
  private refreshInterval: number = 0;

  constructor(leaf: WorkspaceLeaf, plugin: KaoyanCountdownPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_COUNTDOWN; }
  getDisplayText(): string { return '考研倒计时'; }
  getIcon(): string { return 'clock'; }

  async onOpen() {
    this.render();
    this.refreshInterval = window.setInterval(() => this.render(), 60_000);
    this.registerInterval(this.refreshInterval);
  }

  async onClose() { /* registerInterval auto-cleans */ }

  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClass('kaoyan-countdown-container');
    this.renderCountdown(el);
    this.renderPhase(el);
    this.renderTasks(el);
  }

  private renderCountdown(container: HTMLElement) {
    const section = container.createDiv({ cls: 'kc-countdown-section' });
    const days = getDaysRemaining(this.plugin.settings.examDate);

    section.createEl('div', { cls: 'kc-title', text: '🎯 考研倒计时' });
    section.createEl('div', { cls: 'kc-days', text: `${days}` });
    section.createEl('div', { cls: 'kc-days-label', text: '天' });
    section.createEl('div', { cls: 'kc-exam-date', text: `考试日期：${this.plugin.settings.examDate}` });
  }

  private renderPhase(container: HTMLElement) {
    const section = container.createDiv({ cls: 'kc-phase-section' });
    const now = new Date();
    const phase = getCurrentPhase(now);

    if (!phase) {
      section.createEl('div', { cls: 'kc-phase-name', text: '当前不在任何阶段范围内' });
      return;
    }

    const progress = getPhaseProgress(phase, now);
    section.createEl('div', { cls: 'kc-phase-name', text: `📍 Phase ${phase.id} ${phase.name}` });
    section.createEl('div', { cls: 'kc-phase-range', text: `${phase.startDate} → ${phase.endDate}` });

    const barContainer = section.createDiv({ cls: 'kc-progress-bar' });
    const barFill = barContainer.createDiv({ cls: 'kc-progress-fill' });
    barFill.style.width = `${Math.round(progress * 100)}%`;
    section.createEl('div', { cls: 'kc-progress-text', text: `${Math.round(progress * 100)}%` });

    if (this.plugin.settings.showAllocation) {
      const alloc = section.createDiv({ cls: 'kc-allocation' });
      for (const [key, val] of Object.entries(phase.allocation)) {
        if (val && val > 0) {
          const label = SUBJECT_LABELS[key as keyof typeof SUBJECT_LABELS] || key;
          alloc.createEl('span', { cls: 'kc-alloc-tag', text: `${label} ${Math.round(val * 100)}%` });
        }
      }
    }
  }

  private renderTasks(container: HTMLElement) {
    const section = container.createDiv({ cls: 'kc-tasks-section' });
    const now = new Date();

    // 本月里程碑
    const milestone = getCurrentMonthMilestone(now);
    if (milestone) {
      section.createEl('div', { cls: 'kc-section-title', text: `📋 ${milestone.month} 里程碑` });
      for (const item of milestone.items) {
        const row = section.createDiv({ cls: 'kc-task-row' });
        const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        cb.checked = this.plugin.settings.completedMilestones.includes(item);
        cb.addEventListener('change', async () => {
          const ms = this.plugin.settings.completedMilestones;
          if (cb.checked) {
            if (!ms.includes(item)) ms.push(item);
          } else {
            this.plugin.settings.completedMilestones = ms.filter(m => m !== item);
          }
          await this.plugin.saveSettings();
        });
        row.createEl('span', { text: item, cls: cb.checked ? 'kc-completed' : '' });
      }
    }

    // 待办知识点
    section.createEl('div', { cls: 'kc-section-title', text: '📋 待办知识点' });
    const tasks = this.plugin.settings.tasks;
    const grouped: Record<string, typeof tasks> = {};
    for (const t of tasks) {
      (grouped[t.subject] = grouped[t.subject] || []).push(t);
    }

    for (const [subject, items] of Object.entries(grouped)) {
      const label = SUBJECT_LABELS[subject as keyof typeof SUBJECT_LABELS] || subject;
      section.createEl('div', { cls: 'kc-subject-label', text: label });
      for (const task of items) {
        const row = section.createDiv({ cls: 'kc-task-row' });
        const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        cb.checked = task.completed;
        cb.addEventListener('change', async () => {
          task.completed = cb.checked;
          await this.plugin.saveSettings();
          this.render();
        });
        row.createEl('span', { text: task.text, cls: task.completed ? 'kc-completed' : '' });
      }
    }
  }
}
