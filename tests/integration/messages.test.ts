import { expect, test } from 'vitest';
import { database } from '../../src/lib/server/db';
import { acceptProposal, createTask, getTask, recordMessage, recordProposal } from '../../src/lib/server/repository';
import { actions } from '../../src/routes/chat/+page.server';

const remove=(id:string,enhanced=true)=>{
  const body=new FormData();body.set('id',id);
  return (actions.delete as any)({request:new Request('http://localhost/chat?/delete',{method:'POST',headers:enhanced?{'x-sveltekit-action':'true'}:{referer:'http://localhost/today'},body})});
};
test('deleting a message removes its suggestions but keeps accepted tasks and dependencies',async()=>{
  const db=database.sqlite;
  const id=recordMessage('Call the plumber and electrician');
  const accepted=recordProposal(id,{title:'Call plumber'});
  recordProposal(id,{title:'Call electrician'});
  const task=acceptProposal(accepted);
  const prerequisite=createTask({title:'Find phone number'});
  db.prepare("INSERT INTO dependencies(task_id,prerequisite_task_id,source_message_id) VALUES(?,?,?)").run(task,prerequisite,id);
  const other=recordMessage('Keep this message');
  expect(await remove(String(id))).toEqual({deleted:true});
  expect(db.prepare('SELECT id FROM messages WHERE id=?').get(id)).toBeUndefined();
  expect(db.prepare('SELECT id FROM ai_proposals WHERE message_id=?').all(id)).toEqual([]);
  expect(getTask(task)).toMatchObject({title:'Call plumber'});
  expect(db.prepare('SELECT source_message_id FROM dependencies WHERE task_id=?').get(task)).toEqual({source_message_id:null});
  expect(db.prepare('SELECT content FROM messages WHERE id=?').get(other)).toEqual({content:'Keep this message'});
  expect(await remove(String(id))).toMatchObject({status:400});
});
test('message deletion validates IDs and redirects normal form submissions',async()=>{
  const id=recordMessage('Delete with a normal form');
  for(const value of ['', '0', '-1', '1.5', 'not-an-id'])expect(await remove(value)).toMatchObject({status:400});
  expect(database.sqlite.prepare('SELECT id FROM messages WHERE id=?').get(id)).toBeDefined();
  await expect(remove(String(id),false)).rejects.toMatchObject({status:303,location:'/today'});
  expect(database.sqlite.prepare('SELECT id FROM messages WHERE id=?').get(id)).toBeUndefined();
});
