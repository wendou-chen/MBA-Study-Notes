import type { Phase, Milestone } from './types';

export const PHASES: Phase[] = [
  {
    id: 1, name: '基础夯实',
    startDate: '2026-02-14', endDate: '2026-04-20',
    allocation: { math: 0.55, major: 0.20, english: 0.10, competition: 0.15 },
  },
  {
    id: 2, name: '基础收尾',
    startDate: '2026-04-21', endDate: '2026-06-30',
    allocation: { math: 0.50, major: 0.25, english: 0.10, review: 0.15 },
  },
  {
    id: 3, name: '强化突破',
    startDate: '2026-07-01', endDate: '2026-09-30',
    allocation: { math: 0.40, major: 0.25, english: 0.15, politics: 0.15, review: 0.05 },
  },
  {
    id: 4, name: '冲刺模考',
    startDate: '2026-10-01', endDate: '2026-11-30',
    allocation: { math: 0.35, major: 0.25, english: 0.15, politics: 0.20, review: 0.05 },
  },
  {
    id: 5, name: '考前收官',
    startDate: '2026-12-01', endDate: '2026-12-20',
    allocation: { math: 0.30, major: 0.20, english: 0.15, politics: 0.30, review: 0.05 },
  },
];

export const MILESTONES: Milestone[] = [
  { month: '2026.03', items: ['高数上册全书一刷完成', '信号与系统前 4 章通读'] },
  { month: '2026.04', items: ['高数下册全书一刷完成', '大唐杯/蓝桥杯比赛结束'] },
  { month: '2026.05', items: ['线性代数全书一刷完成', '信号与系统前 8 章通读'] },
  { month: '2026.06', items: ['概率论全书一刷完成', '全书二刷启动', '信号教材通读完毕'] },
  { month: '2026.07', items: ['全书二刷过半', '政治精讲精练启动', '英语阅读训练启动'] },
  { month: '2026.08', items: ['全书二刷完成', '信号真题一刷启动', '政治 1000 题过半'] },
  { month: '2026.09', items: ['数学真题一刷完成', '信号真题一刷完成', '政治 1000 题完成'] },
  { month: '2026.10', items: ['首次全科模考', '英语作文模板成型', '政治背诵启动'] },
  { month: '2026.11', items: ['模考 3 轮以上', '各科查漏补缺清单生成'] },
  { month: '2026.12', items: ['考前最终模考', '政治押题卷', '心态调整'] },
];

export function getDaysRemaining(examDate: string): number {
  const exam = new Date(examDate + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((exam.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function getCurrentPhase(now: Date): Phase | null {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return PHASES.find(p => {
    const start = new Date(p.startDate + 'T00:00:00');
    const end = new Date(p.endDate + 'T00:00:00');
    return d >= start && d <= end;
  }) ?? null;
}

export function getPhaseProgress(phase: Phase, now: Date): number {
  const start = new Date(phase.startDate + 'T00:00:00').getTime();
  const end = new Date(phase.endDate + 'T00:00:00').getTime();
  const current = new Date(now).setHours(0, 0, 0, 0);
  return Math.min(1, Math.max(0, (current - start) / (end - start)));
}

export function getCurrentMonthMilestone(now: Date): Milestone | null {
  const monthStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  return MILESTONES.find(m => m.month === monthStr) ?? null;
}
