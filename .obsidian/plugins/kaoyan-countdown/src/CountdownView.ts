import { ItemView, WorkspaceLeaf, TAbstractFile, debounce, Notice } from 'obsidian';
import { getDaysRemaining, getCurrentPhase, getPhaseProgress, getCurrentMonthMilestone } from './phases';
import { SUBJECT_LABELS, FOCUS_SUBJECTS } from './types';
import type { ViewMode, DailyPlan, FocusMode, TimerSnapshot, Subject } from './types';
import { loadDailyPlan, loadWeekOverview, toggleTaskInContent } from './dailyParser';
import { TimerEngine, playSound } from './timerEngine';
import type KaoyanCountdownPlugin from './main';

export const VIEW_TYPE_COUNTDOWN = 'kaoyan-countdown-view';

export class CountdownView extends ItemView {
  plugin: KaoyanCountdownPlugin;
  private refreshInterval: number = 0;
  private dailyPlan: DailyPlan | null = null;
  private timerEngine: TimerEngine;
  private timerDisplayEl: HTMLElement | null = null;
  private timerProgressEl: HTMLElement | null = null;
  private timerStateEl: HTMLElement | null = null;
  private focusSectionEl: HTMLElement | null = null;
  private selectedFocusMode: FocusMode = 'pomodoro';
  private selectedSubject: Subject = 'math';
  private selectedDurationMin = 25;

  constructor(leaf: WorkspaceLeaf, plugin: KaoyanCountdownPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.timerEngine = new TimerEngine();
    this.syncEngineFromSettings();
    this.timerEngine.loadStats(plugin.settings.focusStats);
    this.selectedFocusMode = plugin.settings.focus.defaultFocusMode;
    this.selectedSubject = plugin.settings.focus.defaultSubject;
    this.selectedDurationMin = plugin.settings.focus.pomodoroDurationMin;

    this.timerEngine.on('tick', (snap) => this.onTimerTick(snap));
    this.timerEngine.on('stateChange', (snap) => this.onTimerStateChange(snap));
    this.timerEngine.on('sound', (event) => playSound(event));
  }

  getViewType(): string { return VIEW_TYPE_COUNTDOWN; }
  getDisplayText(): string { return '考研倒计时'; }
  getIcon(): string { return 'clock'; }

  async onOpen() {
    await this.fullRender();
    this.refreshInterval = window.setInterval(() => this.fullRender(), 60_000);
    this.registerInterval(this.refreshInterval);

    // Watch for file changes in plan folder
    const debouncedRefresh = debounce(() => this.fullRender(), 200, true);
    this.registerEvent(
      this.app.vault.on('modify', (file: TAbstractFile) => {
        if (file.path.startsWith(this.plugin.settings.planFolder + '/')) debouncedRefresh();
      })
    );
  }

  async onClose() {
    await this.persistFocusStats();
    this.timerEngine.destroy();
  }

  /** Public method for settings tab to trigger a re-render. */
  async refresh() {
    await this.fullRender();
  }

  private get viewMode(): ViewMode { return this.plugin.settings.viewMode; }

  private async setViewMode(mode: ViewMode) {
    this.plugin.settings.viewMode = mode;
    await this.plugin.saveSettings();
    await this.fullRender();
  }

  private todayStr(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private async fullRender() {
    const el = this.contentEl;
    el.empty();
    el.addClass('kaoyan-countdown-container');
    this.renderCountdown(el);
    this.renderModeTabs(el);
    switch (this.viewMode) {
      case 'day': await this.renderDayMode(el); break;
      case 'week': await this.renderWeekMode(el); break;
      case 'phase': this.renderPhaseMode(el); break;
      case 'focus': this.renderFocusTab(el); break;
    }
  }

  private renderCountdown(container: HTMLElement) {
    const section = container.createDiv({ cls: 'kc-countdown-section' });
    const days = getDaysRemaining(this.plugin.settings.examDate);
    section.createEl('div', { cls: 'kc-title', text: '🎯 考研倒计时' });
    section.createEl('div', { cls: 'kc-days', text: `${days}` });
    section.createEl('div', { cls: 'kc-days-label', text: '天' });
    section.createEl('div', { cls: 'kc-exam-date', text: `考试日期：${this.plugin.settings.examDate}` });

    this.renderBookmarks(section);
  }

  private renderBookmarks(container: HTMLElement) {
    const bookmarks = this.plugin.settings.bookmarks;
    if (!bookmarks || bookmarks.length === 0) return;

    const wrapper = container.createDiv({ cls: 'kc-bookmarks-wrapper' });
    wrapper.createEl('div', { cls: 'kc-bookmarks-title', text: '📖 继续学习' });

    // Show only the most recent one prominently, others as small list or just the recent one
    const recent = bookmarks[0];
    const btn = wrapper.createEl('button', { cls: 'kc-bookmark-btn' });
    btn.createEl('span', { cls: 'kc-bookmark-icon', text: '▶' });
    btn.createEl('span', { cls: 'kc-bookmark-text', text: recent.label });

    // Calculate time ago
    const minutesAgo = Math.floor((Date.now() - recent.timestamp) / 60000);
    const timeLabel = minutesAgo < 60 ? `${minutesAgo}分钟前` : `${Math.floor(minutesAgo / 60)}小时前`;
    btn.createEl('span', { cls: 'kc-bookmark-time', text: timeLabel });
    // 自动保存指示
    btn.createEl('span', { cls: 'kc-bookmark-auto', text: '● 自动' });

    btn.addEventListener('click', async () => {
      const file = this.app.vault.getAbstractFileByPath(recent.filePath);
      if (file) {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file as any, { state: recent.state });
      } else {
        new Notice('文件已不存在');
      }
    });
  }

  private renderModeTabs(container: HTMLElement) {
    const tabs = container.createDiv({ cls: 'kc-tabs' });
    const modes: { mode: ViewMode; label: string }[] = [
      { mode: 'day', label: '📅 Day' },
      { mode: 'week', label: '📊 Week' },
      { mode: 'phase', label: '🗺️ Phase' },
      { mode: 'focus', label: '🍅 Focus' },
    ];
    for (const { mode, label } of modes) {
      const btn = tabs.createEl('button', {
        cls: `kc-tab${this.viewMode === mode ? ' kc-tab-active' : ''}`,
        text: label,
      });
      btn.addEventListener('click', () => this.setViewMode(mode));
    }
  }

  private async renderDayMode(container: HTMLElement) {
    const section = container.createDiv({ cls: 'kc-day-section' });
    const today = this.todayStr();
    this.dailyPlan = await loadDailyPlan(this.app.vault, today, this.plugin.settings.planFolder);

    if (!this.dailyPlan) {
      section.createEl('div', { cls: 'kc-empty', text: '今日暂无计划文件' });
      return;
    }

    const tasks = this.dailyPlan.tasks;
    const done = tasks.filter(t => t.completed).length;
    const total = tasks.length;

    // Progress bar
    const header = section.createDiv({ cls: 'kc-day-header' });
    header.createEl('span', { text: `完成率 ${done}/${total}`, cls: 'kc-day-progress-label' });
    const bar = header.createDiv({ cls: 'kc-progress-bar' });
    const fill = bar.createDiv({ cls: 'kc-progress-fill' });
    fill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';

    // Task list
    for (const task of tasks) {
      const row = section.createDiv({ cls: `kc-day-task${task.completed ? ' kc-day-task-done' : ''}` });
      const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = task.completed;
      cb.addEventListener('change', () => this.toggleDailyTask(task.lineIndex, cb.checked));
      row.createEl('span', { cls: 'kc-day-time', text: task.time });
      row.createEl('span', { cls: 'kc-day-subject', text: task.subject });
      row.createEl('span', { cls: 'kc-day-desc', text: task.description });
    }
  }

  private async toggleDailyTask(lineIndex: number, completed: boolean) {
    if (!this.dailyPlan) return;
    const file = this.app.vault.getAbstractFileByPath(this.dailyPlan.filePath);
    if (!file || !('stat' in file)) return;
    const content = await this.app.vault.read(file as any);
    const newContent = toggleTaskInContent(content, lineIndex, completed);
    await this.app.vault.modify(file as any, newContent);
    // vault.on('modify') will trigger debounced re-render
  }

  private async renderWeekMode(container: HTMLElement) {
    const section = container.createDiv({ cls: 'kc-week-section' });
    const today = this.todayStr();
    const weekDays = await loadWeekOverview(this.app.vault, new Date(), this.plugin.settings.planFolder);

    for (const wd of weekDays) {
      const isToday = wd.date === today;
      const row = section.createDiv({ cls: `kc-week-row${isToday ? ' kc-week-today' : ''}` });

      const info = row.createDiv({ cls: 'kc-week-info' });
      info.createEl('span', { cls: 'kc-week-date', text: `${wd.date.slice(5)}` });
      info.createEl('span', { cls: 'kc-week-day', text: wd.weekday });

      if (wd.filePath) {
        const pct = wd.total > 0 ? Math.round((wd.done / wd.total) * 100) : 0;
        const bar = row.createDiv({ cls: 'kc-progress-bar kc-week-bar' });
        const fill = bar.createDiv({ cls: 'kc-progress-fill' });
        fill.style.width = `${pct}%`;
        row.createEl('span', { cls: 'kc-week-pct', text: `${pct}%` });

        // Click to open the daily plan file
        row.style.cursor = 'pointer';
        const filePath = wd.filePath;
        row.addEventListener('click', () => {
          const f = this.app.vault.getAbstractFileByPath(filePath);
          if (f) this.app.workspace.openLinkText(filePath, '', false);
        });
      } else {
        row.createEl('span', { cls: 'kc-week-empty', text: '—' });
      }
    }
  }

  private renderPhaseMode(container: HTMLElement) {
    this.renderPhase(container);
    this.renderTasks(container);
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
          await this.fullRender();
        });
        row.createEl('span', { text: task.text, cls: task.completed ? 'kc-completed' : '' });
      }
    }
  }

  // ── Focus Tab ──────────────────────────────────────────

  private renderFocusTab(container: HTMLElement) {
    this.focusSectionEl = container.createDiv({ cls: 'kc-focus-section' });
    this.renderFocusContent();
  }

  private renderFocusContent() {
    const section = this.focusSectionEl;
    if (!section) return;
    section.empty();
    const snap = this.timerEngine.getSnapshot();

    this.renderFocusModeToggle(section, snap);
    this.renderTimerDisplay(section, snap);

    // Duration picker: only in IDLE + pomodoro mode
    if (snap.state === 'IDLE' && this.selectedFocusMode === 'pomodoro') {
      this.renderDurationPicker(section);
    }

    if (snap.state === 'IDLE') {
      this.renderSubjectSelector(section);
    } else if (snap.state !== 'MICRO_PAUSE') {
      section.createEl('div', {
        cls: 'kc-focus-current-subject',
        text: `科目: ${SUBJECT_LABELS[snap.subject] || snap.subject}`,
      });
    }

    if (snap.state === 'MICRO_PAUSE') {
      this.renderMicroPauseOverlay(section, snap);
    }

    this.renderTimerControls(section, snap);
    this.renderFocusStats(section, snap);
  }

  private renderFocusModeToggle(container: HTMLElement, snap: TimerSnapshot) {
    const toggle = container.createDiv({ cls: 'kc-focus-mode-toggle' });
    const running = snap.state !== 'IDLE';
    const modes: { mode: FocusMode; label: string }[] = [
      { mode: 'pomodoro', label: '番茄钟' },
      { mode: 'scientific', label: '科学专注' },
      { mode: 'stopwatch', label: '正计时' },
    ];
    for (const { mode, label } of modes) {
      const btn = toggle.createEl('button', {
        cls: `kc-focus-mode-btn${this.selectedFocusMode === mode ? ' kc-focus-mode-active' : ''}${running ? ' kc-disabled' : ''}`,
        text: label,
      });
      if (!running) {
        btn.addEventListener('click', () => {
          if (this.selectedFocusMode === mode) return;
          this.selectedFocusMode = mode;
          this.timerEngine.focusMode = mode;
          this.renderFocusContent();
        });
      }
    }
  }

  private renderTimerDisplay(container: HTMLElement, snap: TimerSnapshot) {
    const display = container.createDiv({ cls: 'kc-timer-display' });
    this.timerStateEl = display.createEl('div', {
      cls: 'kc-timer-state',
      text: this.getStateLabel(snap.state),
    });

    // Determine what time to display
    let displayMs: number;
    if (snap.state === 'IDLE') {
      if (this.selectedFocusMode === 'pomodoro') {
        displayMs = this.selectedDurationMin * 60000;
      } else if (this.selectedFocusMode === 'scientific') {
        displayMs = this.plugin.settings.focus.scientificDurationMin * 60000;
      } else {
        displayMs = 0; // stopwatch starts at 00:00
      }
    } else if (snap.focusMode === 'stopwatch') {
      displayMs = snap.elapsedMs;
    } else {
      displayMs = snap.remainingMs;
    }

    this.timerDisplayEl = display.createEl('div', {
      cls: 'kc-timer-countdown',
      text: this.formatTime(displayMs),
    });

    // Hide progress bar for stopwatch
    const isStopwatch = (snap.state === 'IDLE' && this.selectedFocusMode === 'stopwatch')
      || (snap.state !== 'IDLE' && snap.focusMode === 'stopwatch');
    const bar = display.createDiv({ cls: `kc-timer-progress-bar${isStopwatch ? ' kc-hidden' : ''}` });
    this.timerProgressEl = bar.createDiv({ cls: 'kc-timer-progress-fill' });
    const pct = snap.totalMs > 0 ? ((snap.totalMs - snap.remainingMs) / snap.totalMs) * 100 : 0;
    this.timerProgressEl.style.width = `${Math.min(100, pct)}%`;
  }

  private renderSubjectSelector(container: HTMLElement) {
    const sel = container.createDiv({ cls: 'kc-subject-selector' });
    for (const subj of FOCUS_SUBJECTS) {
      const label = SUBJECT_LABELS[subj] || subj;
      const btn = sel.createEl('button', {
        cls: `kc-subject-btn${this.selectedSubject === subj ? ' kc-subject-btn-active' : ''}`,
        text: label,
      });
      btn.addEventListener('click', () => {
        this.selectedSubject = subj;
        this.renderFocusContent();
      });
    }
  }

  private renderDurationPicker(container: HTMLElement) {
    const picker = container.createDiv({ cls: 'kc-duration-picker' });
    const presets = [15, 25, 30, 45, 60];
    for (const min of presets) {
      const btn = picker.createEl('button', {
        cls: `kc-duration-btn${this.selectedDurationMin === min ? ' kc-duration-btn-active' : ''}`,
        text: `${min}min`,
      });
      btn.addEventListener('click', () => {
        this.selectedDurationMin = min;
        this.renderFocusContent();
      });
    }
  }

  private renderMicroPauseOverlay(container: HTMLElement, snap: TimerSnapshot) {
    const overlay = container.createDiv({ cls: 'kc-micro-pause-overlay' });
    overlay.createEl('div', { cls: 'kc-micro-pause-icon', text: '😌' });
    overlay.createEl('div', { cls: 'kc-micro-pause-text', text: '闭眼休息' });
    overlay.createEl('div', {
      cls: 'kc-micro-pause-timer',
      text: this.formatTime(snap.microPauseRemainingMs),
    });
  }

  private renderTimerControls(container: HTMLElement, snap: TimerSnapshot) {
    const controls = container.createDiv({ cls: 'kc-timer-controls' });

    switch (snap.state) {
      case 'IDLE': {
        const startBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-start', text: '开始专注' });
        startBtn.addEventListener('click', () => {
          this.timerEngine.focusMode = this.selectedFocusMode;
          this.syncEngineFromSettings();
          if (this.selectedFocusMode === 'pomodoro') {
            this.timerEngine.pomodoroDurationMin = this.selectedDurationMin;
          }
          this.timerEngine.start(this.selectedSubject);
        });
        // Strict mode toggle (not for stopwatch)
        if (this.selectedFocusMode !== 'stopwatch') {
          const strictToggle = controls.createDiv({ cls: 'kc-strict-toggle' });
          const cb = strictToggle.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
          cb.checked = this.timerEngine.strictMode;
          cb.addEventListener('change', () => {
            this.timerEngine.strictMode = cb.checked;
            this.plugin.settings.focus.strictMode = cb.checked;
            this.plugin.saveSettings();
          });
          strictToggle.createEl('span', { cls: 'kc-strict-label', text: '学霸模式 (禁止暂停/放弃)' });
        }
        break;
      }
      case 'FOCUSING': {
        if (snap.focusMode === 'stopwatch') {
          // Stopwatch: stop + pause/resume
          const stopBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-stop', text: '结束专注' });
          stopBtn.addEventListener('click', () => this.timerEngine.stopStopwatch());
          if (this.timerEngine.isPaused) {
            const resumeBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-start', text: '继续' });
            resumeBtn.addEventListener('click', () => this.timerEngine.resume());
          } else {
            const pauseBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-pause', text: '暂停' });
            pauseBtn.addEventListener('click', () => {
              this.timerEngine.pause();
              this.renderFocusContent();
            });
          }
        } else if (this.timerEngine.strictMode) {
          controls.createEl('span', { cls: 'kc-strict-label', text: '🔒 学霸模式' });
        } else if (this.timerEngine.isPaused) {
          const resumeBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-start', text: '继续' });
          resumeBtn.addEventListener('click', () => this.timerEngine.resume());
          const resetBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-reset', text: '放弃' });
          resetBtn.addEventListener('click', () => this.timerEngine.reset());
        } else {
          const pauseBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-pause', text: '暂停' });
          pauseBtn.addEventListener('click', () => {
            this.timerEngine.pause();
            this.renderFocusContent();
          });
          const resetBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-reset', text: '放弃' });
          resetBtn.addEventListener('click', () => this.timerEngine.reset());
        }
        break;
      }
      case 'SHORT_BREAK':
      case 'LONG_BREAK': {
        const skipBtn = controls.createEl('button', { cls: 'kc-btn kc-btn-skip', text: '跳过休息' });
        skipBtn.addEventListener('click', () => this.timerEngine.skipBreak());
        break;
      }
      case 'MICRO_PAUSE':
        break;
    }
  }

  private renderFocusStats(container: HTMLElement, snap: TimerSnapshot) {
    const stats = container.createDiv({ cls: 'kc-focus-stats' });
    stats.createEl('span', { cls: 'kc-focus-stat', text: `🍅 ${snap.pomodorosToday} 个番茄` });
    stats.createEl('span', { cls: 'kc-focus-stat', text: `⏱ ${snap.totalFocusMinutesToday} 分钟` });
  }

  // ── Timer callbacks ────────────────────────────────────

  private onTimerTick(snap: TimerSnapshot) {
    if (this.timerDisplayEl) {
      const displayMs = snap.focusMode === 'stopwatch' ? snap.elapsedMs : snap.remainingMs;
      this.timerDisplayEl.textContent = this.formatTime(displayMs);
    }
    if (this.timerProgressEl && snap.totalMs > 0) {
      const pct = ((snap.totalMs - snap.remainingMs) / snap.totalMs) * 100;
      this.timerProgressEl.style.width = `${Math.min(100, pct)}%`;
    }
  }

  private onTimerStateChange(_snap: TimerSnapshot) {
    if (this.viewMode === 'focus') {
      this.renderFocusContent();
    }
    this.persistFocusStats();
  }

  // ── Helpers ────────────────────────────────────────────

  private formatTime(ms: number): string {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    if (h > 0) return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
    return `${mm}:${ss}`;
  }

  private getStateLabel(state: TimerSnapshot['state']): string {
    switch (state) {
      case 'IDLE': return '准备就绪';
      case 'FOCUSING': return '🔥 专注中';
      case 'MICRO_PAUSE': return '😌 微休息';
      case 'SHORT_BREAK': return '☕ 短休息';
      case 'LONG_BREAK': return '🌿 长休息';
    }
  }

  private syncEngineFromSettings() {
    const f = this.plugin.settings.focus;
    const e = this.timerEngine;
    e.pomodoroDurationMin = f.pomodoroDurationMin;
    e.shortBreakMin = f.shortBreakMin;
    e.longBreakMin = f.longBreakMin;
    e.longBreakInterval = f.longBreakInterval;
    e.scientificDurationMin = f.scientificDurationMin;
    e.scientificLongBreakMin = f.scientificLongBreakMin;
    e.microPauseSec = f.microPauseSec;
    e.strictMode = f.strictMode;
    e.autoStart = f.autoStart;
  }

  private async persistFocusStats() {
    const stats = this.timerEngine.exportStats();
    this.plugin.settings.focusStats = stats;
    await this.plugin.saveSettings();
  }
}
