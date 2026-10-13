import { describe, expect, test } from 'vitest';
import { forecastDeadlines, type DeadlineTask, type DeadlineEdge } from '../../src/lib/domain/deadlines';

const task=(id:number,patch:Partial<DeadlineTask>={}):DeadlineTask=>({id,title:`Task ${id}`,state:'open',due_at:null,duration_bucket:null,remaining_effort_minutes:0,lead_time_days:0,...patch});
const hard=(task_id:number,prerequisite_task_id:number):DeadlineEdge=>({task_id,prerequisite_task_id});

describe('start-by forecasts',()=>{
  test.each(['2026-08-12','2026-08-13','2026-08-14'])('warns for seven days of work due on %s with a two-day buffer',due=>{
    const result=forecastDeadlines([task(1,{due_at:due,remaining_effort_minutes:7*480})],[],'2026-08-05',480,2);
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({workDays:7,bufferDays:2,incompleteEstimates:[]});
    expect(result[0].startBy!<='2026-08-05').toBe(true);
  });
  test('warns exactly at the buffered start date; estimates can be updated as work finishes',()=>{
    const tasks=[task(1,{due_at:'2026-08-14',remaining_effort_minutes:7*480})];
    expect(forecastDeadlines(tasks,[],'2026-08-04',480,2)).toEqual([]);
    expect(forecastDeadlines(tasks,[],'2026-08-05',480,2)[0].startBy).toBe('2026-08-05');
    expect(forecastDeadlines(tasks,[],'2026-08-05',480,0)).toEqual([]);
    tasks[0].remaining_effort_minutes=480;
    expect(forecastDeadlines(tasks,[],'2026-08-05',480,2)).toEqual([]);
  });
  test('calendar lead time is additional to capacity days and crosses DST safely',()=>{
    const tasks=[task(1,{due_at:'2026-03-10',remaining_effort_minutes:120,lead_time_days:7})];
    expect(forecastDeadlines(tasks,[],'2026-02-28',60,1)[0]).toMatchObject({workDays:2,leadDays:7,startBy:'2026-02-28'});
  });
  test('counts shared prerequisite effort once and uses the longest chain of lead times',()=>{
    const tasks=[task(1,{due_at:'2026-08-22',remaining_effort_minutes:60,lead_time_days:1}),task(2,{remaining_effort_minutes:120,lead_time_days:2}),task(3,{remaining_effort_minutes:180,lead_time_days:3}),task(4,{remaining_effort_minutes:60,lead_time_days:4}),task(5,{remaining_effort_minutes:5000})];
    const edges=[hard(1,2),hard(1,3),hard(2,4),hard(3,4)];
    const result=forecastDeadlines(tasks,edges,'2026-08-05',60,2)[0];
    expect(result).toMatchObject({effortMinutes:420,workDays:7,leadDays:8,startBy:'2026-08-05'});
    expect(result.prerequisites.map(t=>t.id).sort()).toEqual([2,3,4]);
  });
  test('completed prerequisites stop traversal and completed roots are ignored',()=>{
    const tasks=[task(1,{due_at:'2026-08-06',remaining_effort_minutes:60}),task(2,{state:'completed',remaining_effort_minutes:10000,lead_time_days:10}),task(3,{remaining_effort_minutes:10000})];
    expect(forecastDeadlines(tasks,[hard(1,2),hard(2,3)],'2026-08-05',60,0)[0]).toMatchObject({effortMinutes:60,leadDays:0,prerequisites:[]});
    tasks[0].state='completed';expect(forecastDeadlines(tasks,[],'2026-08-05',60,2)).toEqual([]);
  });
  test('unknown and open-ended durations stay visibly incomplete',()=>{
    const tasks=[task(1,{due_at:'2026-08-08',remaining_effort_minutes:null,duration_bucket:'2h+'}),task(2,{remaining_effort_minutes:null})];
    expect(forecastDeadlines(tasks,[hard(1,2)],'2026-08-05',120,2)[0]).toMatchObject({effortMinutes:120,incompleteEstimates:['Task 1','Task 2']});
    tasks[0].remaining_effort_minutes=0;tasks[1].remaining_effort_minutes=0;
    expect(forecastDeadlines(tasks,[hard(1,2)],'2026-08-06',120,2)[0]).toMatchObject({effortMinutes:0,incompleteEstimates:[]});
  });
  test('zero capacity gives an actionable warning without inventing a start date',()=>{
    expect(forecastDeadlines([task(1,{due_at:'2026-08-14',remaining_effort_minutes:60})],[],'2026-08-05',0,2)[0]).toMatchObject({startBy:null,workDays:null});
  });
  test('ignores invalid dates, due-today tasks, dropped roots, and distant deadlines',()=>{
    const tasks=[task(1,{due_at:'2026-02-30'}),task(2,{due_at:'2026-08-05'}),task(3,{state:'dropped',due_at:'2026-08-06'}),task(4,{due_at:'2027-01-01',remaining_effort_minutes:60})];
    expect(forecastDeadlines(tasks,[],'2026-08-05',480,2)).toEqual([]);
  });
});
