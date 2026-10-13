import { afterEach, describe, expect, test, vi } from 'vitest';
import { TaskAutosave, TaskSaveGroup, type SaveState, type TaskDraft } from '../../src/lib/task-autosave';

const initial: TaskDraft = { title:'Task', details:'', duration:'', dueAt:'', remainingHours:'', leadTimeDays:'0' };
function setup(save: (draft:TaskDraft)=>Promise<void> = async()=>{}) {
  let state: SaveState;
  const values = new Map<string,string>();
  const storage = { getItem:(key:string)=>values.get(key)??null, setItem:(key:string,value:string)=>{values.set(key,value);}, removeItem:(key:string)=>{values.delete(key);} };
  const options = { initial, key:'task', storage, save:vi.fn(save), changed:(next:SaveState)=>{state=next;} };
  const editor = new TaskAutosave(options);
  return {editor,options,values,get state(){return state;}};
}
afterEach(()=>vi.useRealTimers());

describe('task autosave',()=>{
  test('waits three seconds after the last edit and stores recovery immediately',async()=>{
    vi.useFakeTimers();
    const h=setup();
    h.editor.update({...initial,title:'First'});
    expect(JSON.parse(h.values.get('task')!).title).toBe('First');
    await vi.advanceTimersByTimeAsync(2000);
    h.editor.update({...initial,title:'Latest'});
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.options.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.options.save).toHaveBeenCalledExactlyOnceWith({...initial,title:'Latest'});
    expect(h.state.dirty).toBe(false);
    expect(h.values.has('task')).toBe(false);
  });
  test('flush saves immediately and prevents duplicate blur/close requests',async()=>{
    const h=setup();
    h.editor.update({...initial,details:'Changed'});
    expect(await Promise.all([h.editor.flush(),h.editor.flush()])).toEqual([true,true]);
    expect(h.options.save).toHaveBeenCalledTimes(1);
    h.editor.dispose();
  });
  test('queues edits during a request and waits for the newest snapshot',async()=>{
    let finish!:()=>void;
    const h=setup(async()=>{await new Promise<void>(resolve=>{finish=resolve;});});
    h.editor.update({...initial,title:'First'});
    const flushed=h.editor.flush();
    await Promise.resolve();
    h.editor.update({...initial,title:'Latest'});
    expect(h.options.save).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(()=>expect(h.options.save).toHaveBeenCalledTimes(2));
    expect(h.state.draft.title).toBe('Latest');
    expect(JSON.parse(h.values.get('task')!).title).toBe('Latest');
    finish();
    expect(await flushed).toBe(true);
    expect(h.options.save.mock.calls.map(([draft])=>draft.title)).toEqual(['First','Latest']);
    expect(h.values.has('task')).toBe(false);
    h.editor.dispose();
  });
  test('reverting during a request still saves the original value afterward',async()=>{
    let finish!:()=>void;
    const h=setup(async()=>{await new Promise<void>(resolve=>{finish=resolve;});});
    h.editor.update({...initial,title:'Temporary'});
    const flushed=h.editor.flush();await Promise.resolve();
    h.editor.update(initial);
    expect(h.values.has('task')).toBe(true);
    finish();await vi.waitFor(()=>expect(h.options.save).toHaveBeenCalledTimes(2));
    finish();await flushed;
    expect(h.options.save.mock.calls[1][0]).toEqual(initial);
    h.editor.dispose();
  });
  test('failed saves keep the draft for recovery and retry',async()=>{
    const h=setup(async()=>{throw new Error('Offline');});
    h.editor.update({...initial,details:'Keep this'});
    expect(await h.editor.flush()).toBe(false);
    expect(h.state.error).toBe('Offline');
    const restored=new TaskAutosave({...h.options,save:async()=>{}});
    expect(h.state.recovered).toBe(true);
    expect(h.state.draft.details).toBe('Keep this');
    expect(await restored.flush()).toBe(true);
    expect(h.values.has('task')).toBe(false);
    h.editor.dispose();restored.dispose();
  });
  test('invalid edits remain local and do not report success',async()=>{
    const h=setup();
    h.editor.update({...initial,title:' '});
    expect(await h.editor.flush()).toBe(false);
    expect(h.state.error).toBe('Title is required.');
    expect(h.options.save).not.toHaveBeenCalled();
    expect(h.values.has('task')).toBe(true);
    h.editor.update({...initial,title:'Fixed'});
    expect(await h.editor.flush()).toBe(true);
    h.editor.dispose();
  });
  test('an immediate change bypasses the debounce',async()=>{
    const h=setup();
    h.editor.update({...initial,duration:'30m'},true);
    await h.editor.flush();
    expect(h.options.save).toHaveBeenCalledExactlyOnceWith({...initial,duration:'30m'});
  });
  test('storage failure does not prevent saving',async()=>{
    const h=setup();
    h.options.storage.setItem=()=>{throw new Error('Quota');};
    h.editor.update({...initial,title:'New'});
    expect(h.state.storageError).toBe(true);
    expect(await h.editor.flush()).toBe(true);
  });
  test('browser validation blocks an incomplete number even when its exposed value is unchanged',async()=>{
    const h=setup();
    h.editor.update(initial,false,'Enter a number.');
    expect(h.editor.pending).toBe(true);
    expect(await h.editor.flush()).toBe(false);
    expect(h.state.error).toBe('Enter a number.');
    expect(h.options.save).not.toHaveBeenCalled();
    h.editor.dispose();
  });
  test('composition pauses the timer until the composed text is ready',async()=>{
    vi.useFakeTimers();const h=setup();
    h.editor.update({...initial,title:'Composing'});h.editor.pause();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await h.editor.flush()).toBe(false);
    expect(h.options.save).not.toHaveBeenCalled();
    h.editor.update({...initial,title:'Finished'});
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.options.save).toHaveBeenCalledExactlyOnceWith({...initial,title:'Finished'});
  });
  test('unmount cancels the timer without discarding recovery',async()=>{
    vi.useFakeTimers();const h=setup();
    h.editor.update({...initial,details:'Recover on return'});h.editor.dispose();
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.options.save).not.toHaveBeenCalled();
    expect(JSON.parse(h.values.get('task')!).details).toBe('Recover on return');
  });
  test('navigation waits for all editors and refuses invalid drafts',async()=>{
    const group=new TaskSaveGroup();const a=setup();const b=setup();
    const unregister=group.register(a.editor);group.register(b.editor);
    a.editor.update({...initial,title:'A'});b.editor.update({...initial,title:''});
    expect(await group.flush()).toBe(false);
    expect(group.pending).toBe(true);
    b.editor.update({...initial,title:'B'});
    expect(await group.flush()).toBe(true);
    expect(group.pending).toBe(false);
    unregister();a.editor.dispose();b.editor.dispose();
  });
});
