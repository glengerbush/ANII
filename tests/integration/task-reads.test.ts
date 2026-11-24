import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createDatabase} from '../../src/lib/server/db';
import {addDependency,createTask,eventsFor,getDependencies} from '../../src/lib/server/repository';
import {taskMetadata} from '../../src/lib/server/task-reads';
let db:ReturnType<typeof createDatabase>['sqlite'];
beforeEach(()=>{db=createDatabase(':memory:').sqlite;});
afterEach(()=>db.close());

test('metadata retains both dependency directions, excludes unselected metadata, and deduplicates tasks',()=>{
  const [a,b,c]=['A','B','C'].map(title=>createTask({title},db));
  addDependency(b,a,db);addDependency(c,b,db);
  const meta=taskMetadata([{id:b},{id:a},{id:b}],db);
  expect(Object.keys(meta).map(Number)).toEqual([a,b]);
  expect(meta[b].prerequisites).toMatchObject([{task_id:b,prerequisite_task_id:a,title:'A'}]);
  expect(meta[b].dependents).toMatchObject([{task_id:c,prerequisite_task_id:b,title:'C'}]);
  expect(meta[a].prerequisites).toEqual([]);
  for (const id of [a,b]) expect(meta[id]).toEqual({...getDependencies(id,db),history:eventsFor(id,db)});
});

test('each task retains its latest twenty events even when other entities share its id',()=>{
  const ids=['A','B','C'].map(title=>createTask({title},db));
  const insert=db.prepare('INSERT INTO events(entity_type,entity_id,event_type,data) VALUES(?,?,?,?)');
  for (let i=0;i<25;i++) for (const id of ids) insert.run('task',id,'edited',JSON.stringify({i}));
  insert.run('project',ids[0],'unrelated','{}');
  const meta=taskMetadata(ids.slice(0,2).map(id=>({id})),db);
  expect(meta[ids[2]]).toBeUndefined();
  for (const id of ids.slice(0,2)) {
    expect(meta[id].history).toEqual(eventsFor(id,db));
    expect(meta[id].history).toHaveLength(20);
    expect(JSON.parse(meta[id].history[0].data)).toEqual({i:24});
    expect(JSON.parse(meta[id].history[19].data)).toEqual({i:5});
  }
});

test('metadata query count stays bounded as task selections grow',()=>{
  const tasks=Array.from({length:100},(_,i)=>({id:createTask({title:`Task ${i}`},db)}));
  const prepare=vi.spyOn(db,'prepare');
  expect(taskMetadata([],db)).toEqual({});expect(prepare).not.toHaveBeenCalled();
  taskMetadata(tasks.slice(0,1),db);const single=prepare.mock.calls.length;
  prepare.mockClear();const result=taskMetadata(tasks,db);
  expect(Object.keys(result)).toHaveLength(100);
  expect(prepare.mock.calls.length).toBeLessThanOrEqual(single);
  expect(prepare.mock.calls.length).toBeLessThanOrEqual(3);
});
