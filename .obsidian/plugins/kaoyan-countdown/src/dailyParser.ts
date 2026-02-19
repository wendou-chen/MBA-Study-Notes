import type { Vault, TFile } from 'obsidian';
import type { DailyTask, DailyPlan, WeekDay } from './types';

const TABLE_ROW_RE = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(⬜|✅)\s*\|/;
const CHECKLIST_RE = /^- \[([ xX])\]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)/;

export function parseDailyTasks(content: string): DailyTask[] {
  const lines = content.split('\n');
  const tasks: DailyTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tableMatch = lines[i].match(TABLE_ROW_RE);
    if (tableMatch) {
      const time = tableMatch[1].trim();
      // Skip header / separator rows
      if (time.includes('时间') || time.startsWith(':') || time.startsWith('-')) continue;
      tasks.push({
        time,
        subject: tableMatch[2].replace(/\*/g, '').trim(),
        description: tableMatch[3].replace(/\*/g, '').trim(),
        completed: tableMatch[4].trim() === '✅',
        lineIndex: i,
      });
      continue;
    }
    const checkMatch = lines[i].match(CHECKLIST_RE);
    if (checkMatch) {
      tasks.push({
        time: checkMatch[2].trim(),
        subject: checkMatch[3].replace(/\*/g, '').trim(),
        description: checkMatch[4].replace(/\*/g, '').trim(),
        completed: checkMatch[1] !== ' ',
        lineIndex: i,
      });
    }
  }
  return tasks;
}

export function toggleTaskInContent(content: string, lineIndex: number, completed: boolean): string {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return content;
  const line = lines[lineIndex];
  if (line.includes('⬜') || line.includes('✅')) {
    lines[lineIndex] = completed
      ? line.replace('⬜', '✅')
      : line.replace('✅', '⬜');
  } else {
    lines[lineIndex] = completed
      ? line.replace('- [ ]', '- [x]')
      : line.replace(/- \[[xX]\]/, '- [ ]');
  }
  return lines.join('\n');
}

export function findDailyPlanFile(vault: Vault, date: string, planFolder: string): TFile | null {
  const files = vault.getFiles();
  const prefix = `${planFolder}/${date}`;
  return files.find(f => f.path.startsWith(prefix) && f.extension === 'md') ?? null;
}

export async function loadDailyPlan(vault: Vault, date: string, planFolder: string): Promise<DailyPlan | null> {
  const file = findDailyPlanFile(vault, date, planFolder);
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

export async function loadWeekOverview(vault: Vault, date: Date, planFolder: string): Promise<WeekDay[]> {
  const dates = getWeekDates(date);
  const result: WeekDay[] = [];
  for (const d of dates) {
    const dateStr = formatDate(d);
    const plan = await loadDailyPlan(vault, dateStr, planFolder);
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
