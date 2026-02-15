import type { FocusMode, TimerState, TimerSnapshot, SoundEvent, Subject, FocusStats } from './types';

type EngineEvent = 'tick' | 'stateChange' | 'sound';
type EngineCallback = (snapshot: TimerSnapshot) => void;
type SoundCallback = (event: SoundEvent) => void;

// ── Audio ──────────────────────────────────────────────
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playTone(freq: number, duration: number, volume: number) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch { /* audio not available */ }
}

export function playSound(event: SoundEvent) {
  switch (event) {
    case 'microPauseStart':
      playTone(600, 0.2, 0.15);
      break;
    case 'microPauseEnd':
      playTone(600, 0.15, 0.2);
      setTimeout(() => playTone(700, 0.15, 0.2), 180);
      break;
    case 'focusEnd':
      playTone(800, 0.5, 0.3);
      break;
    case 'breakEnd':
      playTone(700, 0.3, 0.25);
      break;
  }
}

// ── Timer Engine ───────────────────────────────────────
function randomMicroPauseInterval(): number {
  // 6-9 minutes in ms
  return (Math.floor(Math.random() * 4) + 6) * 60 * 1000;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class TimerEngine {
  // Config (synced from settings)
  focusMode: FocusMode = 'pomodoro';
  pomodoroDurationMin = 25;
  shortBreakMin = 5;
  longBreakMin = 15;
  longBreakInterval = 4;
  scientificDurationMin = 90;
  scientificLongBreakMin = 20;
  microPauseSec = 15;
  strictMode = false;
  autoStart = false;

  // Runtime state
  private _state: TimerState = 'IDLE';
  private _remainingMs = 0;
  private _totalMs = 0;
  private _pomodorosToday = 0;
  private _totalFocusMs = 0;
  private _pomodoroCount = 0; // within current cycle
  private _nextMicroPauseMs = 0;
  private _prePauseRemainingMs = 0;
  private _prePauseTotalMs = 0;
  private _tickInterval: number | null = null;
  private _statsDate = '';
  private _subject: Subject = 'math';
  private _paused = false;
  private _elapsedMs = 0;

  // Callbacks
  private _tickCbs: EngineCallback[] = [];
  private _stateChangeCbs: EngineCallback[] = [];
  private _soundCbs: SoundCallback[] = [];

  on(event: 'tick', cb: EngineCallback): void;
  on(event: 'stateChange', cb: EngineCallback): void;
  on(event: 'sound', cb: SoundCallback): void;
  on(event: EngineEvent, cb: EngineCallback | SoundCallback) {
    if (event === 'tick') this._tickCbs.push(cb as EngineCallback);
    else if (event === 'stateChange') this._stateChangeCbs.push(cb as EngineCallback);
    else if (event === 'sound') this._soundCbs.push(cb as SoundCallback);
  }

  getSnapshot(): TimerSnapshot {
    return {
      state: this._state,
      remainingMs: this._state === 'MICRO_PAUSE' ? this._remainingMs : this._remainingMs,
      totalMs: this._state === 'MICRO_PAUSE' ? this.microPauseSec * 1000 : this._totalMs,
      focusMode: this.focusMode,
      pomodorosToday: this._pomodorosToday,
      totalFocusMinutesToday: Math.floor(this._totalFocusMs / 60000),
      pomodoroCount: this._pomodoroCount,
      subject: this._subject,
      microPauseRemainingMs: this._state === 'MICRO_PAUSE' ? this._remainingMs : 0,
      elapsedMs: this._elapsedMs,
    };
  }

  loadStats(stats: FocusStats) {
    const today = todayStr();
    if (stats.statsDate === today) {
      this._pomodorosToday = stats.pomodorosToday;
      this._totalFocusMs = stats.totalFocusMinutesToday * 60000;
    } else {
      this._pomodorosToday = 0;
      this._totalFocusMs = 0;
    }
    this._statsDate = today;
  }

  exportStats(): FocusStats {
    return {
      pomodorosToday: this._pomodorosToday,
      totalFocusMinutesToday: Math.floor(this._totalFocusMs / 60000),
      statsDate: this._statsDate || todayStr(),
    };
  }

  start(subject: Subject) {
    this._subject = subject;
    this._paused = false;
    this._elapsedMs = 0;
    this.checkDateReset();

    if (this.focusMode === 'stopwatch') {
      this._totalMs = 0;
      this._remainingMs = 0;
    } else if (this.focusMode === 'pomodoro') {
      this._totalMs = this.pomodoroDurationMin * 60000;
      this._remainingMs = this._totalMs;
    } else {
      this._totalMs = this.scientificDurationMin * 60000;
      this._remainingMs = this._totalMs;
      this._nextMicroPauseMs = randomMicroPauseInterval();
    }
    this.transition('FOCUSING');
    this.startTicking();
  }

  pause(): boolean {
    if (this.strictMode) return false;
    if (this._state !== 'FOCUSING') return false;
    this._paused = true;
    this.stopTicking();
    return true;
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    this.startTicking();
  }

  reset(): boolean {
    if (this.strictMode && this._state === 'FOCUSING') return false;
    this.stopTicking();
    this._paused = false;
    this._elapsedMs = 0;
    this._pomodoroCount = 0;
    this.transition('IDLE');
    return true;
  }

  skipBreak() {
    if (this._state !== 'SHORT_BREAK' && this._state !== 'LONG_BREAK') return;
    this.stopTicking();
    this.handleBreakEnd();
  }

  stopStopwatch() {
    if (this._state !== 'FOCUSING' || this.focusMode !== 'stopwatch') return;
    this.stopTicking();
    this.emitSound('focusEnd');
    this._elapsedMs = 0;
    this._paused = false;
    this.transition('IDLE');
  }

  get isPaused(): boolean { return this._paused; }
  get state(): TimerState { return this._state; }

  destroy() {
    this.stopTicking();
  }

  private startTicking() {
    this.stopTicking();
    this._tickInterval = window.setInterval(() => this.tick(), 1000);
  }

  private stopTicking() {
    if (this._tickInterval !== null) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  private transition(newState: TimerState) {
    this._state = newState;
    for (const cb of this._stateChangeCbs) cb(this.getSnapshot());
  }

  private emitTick() {
    const snap = this.getSnapshot();
    for (const cb of this._tickCbs) cb(snap);
  }

  private emitSound(event: SoundEvent) {
    for (const cb of this._soundCbs) cb(event);
  }

  private checkDateReset() {
    const today = todayStr();
    if (this._statsDate !== today) {
      this._pomodorosToday = 0;
      this._totalFocusMs = 0;
      this._statsDate = today;
    }
  }

  private tick() {
    // Stopwatch: count up, never ends automatically
    if (this.focusMode === 'stopwatch' && this._state === 'FOCUSING') {
      this._elapsedMs += 1000;
      this._totalFocusMs += 1000;
      this.emitTick();
      return;
    }

    this._remainingMs -= 1000;

    if (this._state === 'FOCUSING') {
      this._totalFocusMs += 1000;

      // Scientific mode: micro-pause logic
      if (this.focusMode === 'scientific') {
        this._nextMicroPauseMs -= 1000;
        if (this._nextMicroPauseMs <= 0 && this._remainingMs > this.microPauseSec * 1000) {
          // Enter micro-pause
          this._prePauseRemainingMs = this._remainingMs;
          this._prePauseTotalMs = this._totalMs;
          this._remainingMs = this.microPauseSec * 1000;
          this._totalMs = this.microPauseSec * 1000;
          this.emitSound('microPauseStart');
          this.transition('MICRO_PAUSE');
          return;
        }
      }
    }

    if (this._remainingMs <= 0) {
      this.handleTimerEnd();
      return;
    }

    this.emitTick();
  }

  private handleTimerEnd() {
    this.stopTicking();

    switch (this._state) {
      case 'FOCUSING':
        this._pomodorosToday++;
        this._pomodoroCount++;
        this.emitSound('focusEnd');

        if (this.focusMode === 'pomodoro') {
          if (this._pomodoroCount >= this.longBreakInterval) {
            this._pomodoroCount = 0;
            this._totalMs = this.longBreakMin * 60000;
            this._remainingMs = this._totalMs;
            this.transition('LONG_BREAK');
          } else {
            this._totalMs = this.shortBreakMin * 60000;
            this._remainingMs = this._totalMs;
            this.transition('SHORT_BREAK');
          }
        } else {
          // Scientific mode: long break after full session
          this._totalMs = this.scientificLongBreakMin * 60000;
          this._remainingMs = this._totalMs;
          this.transition('LONG_BREAK');
        }
        this.startTicking();
        break;

      case 'MICRO_PAUSE':
        this.emitSound('microPauseEnd');
        this._remainingMs = this._prePauseRemainingMs;
        this._totalMs = this._prePauseTotalMs;
        this._nextMicroPauseMs = randomMicroPauseInterval();
        this.transition('FOCUSING');
        this.startTicking();
        break;

      case 'SHORT_BREAK':
      case 'LONG_BREAK':
        this.handleBreakEnd();
        break;
    }
  }

  private handleBreakEnd() {
    this.emitSound('breakEnd');
    if (this.autoStart) {
      this.start(this._subject);
    } else {
      this._remainingMs = 0;
      this._totalMs = 0;
      this.transition('IDLE');
    }
  }
}
