export type Subject = 'math' | 'major' | 'english' | 'politics' | 'competition' | 'review';

export interface Phase {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  allocation: Partial<Record<Subject, number>>;
}

export interface Milestone {
  month: string;
  items: string[];
}

export interface TaskItem {
  id: string;
  subject: Subject;
  text: string;
  completed: boolean;
}

export interface KaoyanSettings {
  examDate: string;
  tasks: TaskItem[];
  completedMilestones: string[];
  showAllocation: boolean;
}

export const SUBJECT_LABELS: Record<Subject, string> = {
  math: '数学',
  major: '专业课',
  english: '英语',
  politics: '政治',
  competition: '竞赛',
  review: '模考/复盘',
};

export const DEFAULT_TASKS: TaskItem[] = [
  { id: 'm1', subject: 'math', text: '高数上册全书一刷', completed: false },
  { id: 'm2', subject: 'math', text: '高数下册全书一刷', completed: false },
  { id: 'm3', subject: 'math', text: '线性代数全书一刷', completed: false },
  { id: 'm4', subject: 'math', text: '概率论全书一刷', completed: false },
  { id: 'm5', subject: 'math', text: '全书二刷', completed: false },
  { id: 'm6', subject: 'math', text: '数学真题一刷', completed: false },
  { id: 'j1', subject: 'major', text: '信号与系统教材通读', completed: false },
  { id: 'j2', subject: 'major', text: '信号与系统真题一刷', completed: false },
  { id: 'e1', subject: 'english', text: '单词 5500 过一遍', completed: false },
  { id: 'e2', subject: 'english', text: '英语阅读训练', completed: false },
  { id: 'e3', subject: 'english', text: '作文模板成型', completed: false },
  { id: 'p1', subject: 'politics', text: '精讲精练 + 1000 题', completed: false },
  { id: 'p2', subject: 'politics', text: '政治背诵', completed: false },
  { id: 'p3', subject: 'politics', text: '押题卷', completed: false },
];

export const DEFAULT_SETTINGS: KaoyanSettings = {
  examDate: '2026-12-20',
  tasks: DEFAULT_TASKS,
  completedMilestones: [],
  showAllocation: true,
};
