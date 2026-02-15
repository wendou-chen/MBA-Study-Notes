import type { Vault, TFile } from 'obsidian';
import type { DailyTask, DailyPlan, WeekDay } from './types';

const PLAN_FOLDER = '考研计划';
const TABLE_ROW_RE = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(⬜|✅)\s*\|/;

export function parseDailyTasks(content: string): DailyTask[] {
  const lines = content.split('\n');
  const tasks: DailyTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TABLE_ROW_RE);
    if (!m) continue;
    const time = m[1].trim();
    // Skip header / separator rows
    if (time.includes('时间') || time.startsWith(':') || time.startsWith('-')) continue;
    tasks.push({
      time,
      subject: m[2].replace(/\*/g, '').trim(),
      description: m[3].replace(/\*/g, '').trim(),
      completed: m[4].trim() === '✅',
      lineIndex: i,
    });
  }
  return tasks;
}

export function toggleTaskInContent(content: string, lineIndex: number, completed: boolean): string {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return content;
  lines[lineIndex] = completed
    ? lines[lineIndex].replace('⬜', '✅')
    : lines[lineIndex].replace('✅', '⬜');
  return lines.join('\n');
}

export function findDailyPlanFile(vault: Vault, date: string): TFile | null {
  const files = vault.getFiles();
  const prefix = `${PLAN_FOLDER}/${date}`;
  return files.find(f => f.path.startsWith(prefix) && f.extension === 'md') ?? null;
}

export async function loadDailyPlan(vault: Vault, date: string): Promise<DailyPlan | null> {
  const file = findDailyPlanFile(vault, date);
  if (!file) return null;
  const content = await vault.read(file);
  return { date, tasks: parseDailyTasks(content), filePath: file.path };
}

export function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    dates.push(dd);
  }
  return dates;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function loadWeekOverview(vault: Vault, date: Date): Promise<WeekDay[]> {
  const dates = getWeekDates(date);
  const result: WeekDay[] = [];
  for (const d of dates) {
    const dateStr = formatDate(d);
    const plan = await loadDailyPlan(vault, dateStr);
    result.push({
      date: dateStr,
      weekday: WEEKDAY_NAMES[d.getDay()],
      total: plan ? plan.tasks.length : 0,
      done: plan ? plan.tasks.filter(t => t.completed).length : 0,
      filePath: plan ? plan.filePath : null,
    });
  }
  return result;
}
