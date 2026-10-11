export type TaskState = 'open' | 'waiting' | 'completed' | 'dropped';
export const durationMinutes: Record<string, number> = { '15m': 15, '30m': 30, '1h': 60, '2h+': 120 };

export function transitionTask(from: TaskState, to: TaskState): TaskState {
  if (from === 'dropped' && to === 'completed') throw new Error('Archived legacy tasks cannot be completed');
  if (from === 'completed' && to === 'waiting') throw new Error('Completed tasks cannot wait');
  return to;
}

export function assertFocusCapacity(current: number, adding = 1): void {
  if (current + adding > 3) throw new Error('Focus cannot exceed three tasks');
}

export function wouldCreateCycle(edges: Array<[number, number]>, taskId: number, prerequisiteId: number): boolean {
  if (taskId === prerequisiteId) return true;
  const outgoing = new Map<number, number[]>();
  for (const [task, pre] of edges) outgoing.set(task, [...(outgoing.get(task) ?? []), pre]);
  const stack = [prerequisiteId]; const seen = new Set<number>();
  while (stack.length) { const current = stack.pop()!; if (current === taskId) return true; if (!seen.has(current)) { seen.add(current); stack.push(...(outgoing.get(current) ?? [])); } }
  return false;
}
