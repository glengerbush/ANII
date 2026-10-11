import { describe, expect, it } from 'vitest';
import { durationEstimateLabel, plannedWorkLabel, projectTone, taskProjects, taskStatus } from '../../src/lib/presentation/task';

describe('task presentation', () => {
  it('uses the required status precedence', () => {
    expect(taskStatus({ state: 'completed', blocked: true }, '2026-08-05').key).toBe('completed');
    expect(taskStatus({ state: 'dropped', due_at: '2026-08-01' }, '2026-08-05')).toEqual({key:'completed',label:'Unavailable'});
    expect(taskStatus({ blocked: true, due_at: '2026-08-01', state: 'waiting' }, '2026-08-05').key).toBe('blocked');
    expect(taskStatus({ due_at: '2026-08-01', state: 'waiting' }, '2026-08-05').key).toBe('overdue');
    expect(taskStatus({ due_at: '2026-08-05', state: 'waiting' }, '2026-08-05').key).toBe('today');
    expect(taskStatus({ due_at: '2026-08-06', state: 'waiting' }, '2026-08-05').key).toBe('future');
    expect(taskStatus({ state: 'waiting' }, '2026-08-05').key).toBe('waiting');
    expect(taskStatus({ state: 'open' }, '2026-08-05').key).toBe('ready');
  });

  it('limits collapsed project presentation', () => {
    expect(taskProjects({ project_ids: [4, 5, 6], project_names: ['One', 'Two', 'Three'] })).toEqual({ visible: [{ id: 4, name: 'One' }, { id: 5, name: 'Two' }], hidden: [{ id: 6, name: 'Three' }] });
  });

  it('assigns only deterministic project tones', () => {
    expect([projectTone(1), projectTone(2), projectTone(3), projectTone(1)]).toEqual(['purple', 'magenta', 'blue', 'purple']);
  });

  it('totals planned duration conservatively', () => {
    expect(plannedWorkLabel([{ duration_bucket: '30m' }, { duration_bucket: '2h+' }])).toBe('2h 30m+ planned');
    expect(plannedWorkLabel([])).toBe('Unestimated');
  });

  it('formats remaining estimates and preserves open-ended meaning', () => {
    expect(durationEstimateLabel(150, true)).toBe('2h 30m+');
    expect(durationEstimateLabel(0, false)).toBe('None estimated');
  });
});
