import {expect,test} from 'vitest';
import {database} from '../../src/lib/server/db';
import {actions,load} from '../../src/routes/backlog/+page.server';
import {createProfile,createTask,getNow,today} from '../../src/lib/server/repository';

test('Backlog actions preserve profile/date/group constraints and filtered moves update Now',async()=>{
 const profile=createProfile('Ordering owner'),other=createProfile('Ordering other');
 const a=createTask({title:'Visible A'}),b=createTask({title:'Hidden B'}),c=createTask({title:'Visible C'});
 const cookies={get:()=>String(profile)},date=today();
 const call=(name:'plan'|'move',fields:Record<string,string|number>)=>(actions[name] as any)({cookies,request:new Request(`http://localhost/backlog?/${name}`,{method:'POST',body:new URLSearchParams(Object.fromEntries(Object.entries({profileId:profile,planDate:date,...fields}).map(([k,v])=>[k,String(v)])))})});
 const page=(q='')=>(load as any)({cookies,url:new URL(`http://localhost/backlog?q=${q}`)});
 try{
  for(const taskId of [a,b,c])await expect(call('plan',{taskId,planned:'true'})).resolves.toMatchObject({success:true});
  expect(page('Visible').tasks.map((t:any)=>t.id)).toEqual([a,c]);
  const invalidMoves:Record<string,string|number>[]=[{profileId:other},{planDate:'2000-01-01'},{group:'unqueued'},{anchorId:99999},{edge:'sideways'}];
  for(const fields of invalidMoves){
   await expect(call('move',{taskId:c,anchorId:a,edge:'before',group:'queued',...fields})).resolves.toMatchObject({status:400});
  }
  expect(getNow(undefined,undefined,profile).map(t=>t.id)).toEqual([a,b,c]);
  await expect(call('move',{taskId:c,anchorId:a,edge:'before',group:'queued'})).resolves.toMatchObject({success:true});
  expect(getNow(undefined,undefined,profile).map(t=>t.id)).toEqual([c,a,b]);
  expect(page('Visible').tasks.map((t:any)=>t.id)).toEqual([c,a]);
  await expect(call('plan',{taskId:a,planned:'false'})).resolves.toMatchObject({success:true});
  expect(page().tasks.map((t:any)=>[t.id,t.queued])).toEqual([[c,true],[b,true],[a,false]]);
  expect(getNow(undefined,undefined,other)).toEqual([]);
 }finally{
  for(const id of [a,b,c])database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);
  for(const id of [profile,other])database.sqlite.prepare('DELETE FROM profiles WHERE id=?').run(id);
 }
});
