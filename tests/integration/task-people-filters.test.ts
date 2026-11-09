import {afterEach,expect,test} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {createDatabase} from '../../src/lib/server/db';
import {acceptProposal,createAndPlan,createProfile,createTask,deleteProfile,exportData,getBacklog,getOrderedBacklog,getTask,importData,recordMessage,recordProposal,scheduleTask,setTaskState,today,updateTask} from '../../src/lib/server/repository';
import {acceptAiProposal,saveAiResult} from '../../src/lib/server/ai-proposals';
import {restoreDatabaseBytes} from '../../src/lib/server/database-restore';
const databases:ReturnType<typeof createDatabase>[]=[];
const directories:string[]=[];
function database(){const db=createDatabase(':memory:');databases.push(db);return db.sqlite;}
afterEach(()=>{for(const db of databases.splice(0))db.sqlite.close();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});

test('assignment and creator filters intersect with project/search/state and distinguish Everyone from unscheduled',()=>{
 const db=database(),a=createProfile('Alice',db),b=createProfile('Bob',db),date=today(db);
 const personal=createTask({title:'Clean kitchen'},db,a),shared=createTask({title:'Clean hallway'},db,b),unscheduled=createTask({title:'Clean garage'},db);
 scheduleTask(personal,date,b,db);scheduleTask(shared,date,null,db);
 const ids=(filters:Parameters<typeof getBacklog>[0])=>getBacklog(filters,db).map(t=>t.id);
 expect(ids({assignee:b})).toEqual([personal]);expect(ids({assignee:a})).toEqual([]);
 expect(ids({assignee:'everyone'})).toEqual([shared]);expect(ids({assignee:'unassigned'})).toEqual([unscheduled]);
 expect(ids({creator:a,q:'kitchen',project:'none',assignee:b})).toEqual([personal]);
 expect(ids({creator:b,assignee:b})).toEqual([]);expect(ids({creator:'unknown'})).toEqual([unscheduled]);
 expect(getOrderedBacklog({creator:a,assignee:b},db,a,date).map(t=>t.id)).toEqual([personal]);
 updateTask(personal,{title:'Clean new kitchen'},db);scheduleTask(personal,date,a,db);setTaskState(personal,'completed',db,a);
 expect(ids({creator:a,assignee:a})).toEqual([]);
 expect(ids({creator:a,assignee:a,state:'completed'})).toEqual([personal]);
 expect(getTask(personal,db)?.creator_id).toBe(a);
});

test('Now and accepted AI tasks retain their creator; deleting that profile keeps tasks',()=>{
 const db=database(),creator=createProfile('Creator',db);
 const now=createAndPlan('Now task','also',db,creator);
 const message=recordMessage('Tasks to accept',db);
 recordProposal(message,{title:'Legacy proposal'},{},db);
 const legacyId=(db.prepare('SELECT id FROM ai_proposals WHERE message_id=?').get(message) as {id:number}).id;
 const legacy=acceptProposal(legacyId,db,creator);
 saveAiResult(recordMessage('Another proposal',db),{tasks:[{ref:'task',title:'AI task'}]},'test',db);
 const proposal=(db.prepare("SELECT id FROM ai_proposals WHERE kind='task_changes'").get() as {id:number}).id;
 const accepted=acceptAiProposal(proposal,db,creator) as Record<string,number>;
 for(const id of [now,legacy,accepted.task])expect(getTask(id,db)?.creator_id).toBe(creator);
 deleteProfile(creator,'Creator',db);
 for(const id of [now,legacy,accepted.task])expect(getTask(id,db)?.creator_id).toBeNull();
});

test('creator survives JSON export/import; older snapshots import with unknown creator',()=>{
 const db=database(),creator=createProfile('Author',db),id=createTask({title:'Keep attribution'},db,creator);
 const snapshot=exportData(db);importData(snapshot,db);expect(getTask(id,db)?.creator_id).toBe(creator);
 for(const task of snapshot.tables.tasks)delete (task as Record<string,unknown>).creator_id;
 importData(snapshot,db);expect(getTask(id,db)?.creator_id).toBeNull();
});

test('existing databases migrate without inventing creators and old SQLite backups still restore',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'anii-creator-'));directories.push(dir);
 const path=join(dir,'legacy.db'),old=new Database(path);
 old.exec(readFileSync('drizzle/0000_initial.sql','utf8'));old.prepare('INSERT INTO tasks(title) VALUES(?)').run('Existing task');old.close();
 const bytes=readFileSync(path),migrated=createDatabase(path);databases.push(migrated);
 expect(getBacklog({},migrated.sqlite)[0]).toMatchObject({title:'Existing task',creator_id:null});
 expect(readdirSync(join(dir,'backups')).length).toBe(1);
 await restoreDatabaseBytes(bytes,{liveDatabase:migrated,livePath:path,stagingRoot:dir});
 expect(getBacklog({},migrated.sqlite)[0]).toMatchObject({title:'Existing task',creator_id:null});
});
