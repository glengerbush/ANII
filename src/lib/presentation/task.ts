export type TaskStatus = 'blocked' | 'overdue' | 'today' | 'future' | 'waiting' | 'ready' | 'completed';
export type ProjectTone = 'blue' | 'purple' | 'magenta';

export interface PresentableTask {
  blocked?: boolean | number;
  due_at?: string | null;
  state?: string;
  duration_bucket?: string | null;
}

export function localDate(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function taskStatus(task: PresentableTask, today = localDate()): { key: TaskStatus; label: string } {
  if (task.state === 'completed') return { key: 'completed', label: 'Completed' };
  if (task.state === 'dropped') return { key: 'completed', label: 'Unavailable' };
  if (task.blocked) return { key: 'blocked', label: 'Blocked' };
  if (task.due_at && task.due_at < today) return { key: 'overdue', label: 'Overdue' };
  if (task.due_at === today) return { key: 'today', label: 'Due today' };
  if (task.due_at && task.due_at > today) return { key: 'future', label: `Due ${task.due_at}` };
  if (task.state === 'waiting') return { key: 'waiting', label: 'Waiting' };
  return { key: 'ready', label: 'Ready' };
}

export function taskProjects(task: { project_ids?: number[]; project_names?: string[] }, limit = 2) {
  const projects = (task.project_names ?? []).map((name, index) => ({ id: task.project_ids?.[index] ?? index, name }));
  return { visible: projects.slice(0, limit), hidden: projects.slice(limit) };
}

export function projectTone(id: number): ProjectTone {
  return (['blue', 'purple', 'magenta'] as const)[Math.abs(id) % 3];
}

export function plannedWorkLabel(tasks: PresentableTask[]): string {
  let minimum = 0;
  let openEnded = false;
  for (const task of tasks) {
    if (task.duration_bucket === '15m') minimum += 15;
    else if (task.duration_bucket === '30m') minimum += 30;
    else if (task.duration_bucket === '1h') minimum += 60;
    else if (task.duration_bucket === '2h+') { minimum += 120; openEnded = true; }
  }
  if (!minimum) return 'Unestimated';
  const hours = Math.floor(minimum / 60);
  const minutes = minimum % 60;
  const value = [hours ? `${hours}h` : '', minutes ? `${minutes}m` : ''].filter(Boolean).join(' ');
  return `${value}${openEnded ? '+' : ''} planned`;
}

export function durationEstimateLabel(minutes: number, openEnded = false): string {
  if (!minutes) return 'None estimated';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const value = [hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ');
  return `${value}${openEnded ? '+' : ''}`;
}
