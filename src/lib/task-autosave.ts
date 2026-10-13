export type TaskDraft = {
  title: string;
  details: string;
  duration: string;
  dueAt: string;
  remainingHours: string;
  leadTimeDays: string;
};
export const draftFields = ['title', 'details', 'duration', 'dueAt', 'remainingHours', 'leadTimeDays'] as const;
export const taskDraftKey = (id: number) => `anii:task-draft:v1:${id}`;
export function taskDraft(task: {title:string;details?:string;duration_bucket?:string|null;due_at?:string|null;remaining_effort_minutes?:number|null;lead_time_days?:number|null}): TaskDraft {
  return {title:task.title,details:task.details??'',duration:task.duration_bucket??'',dueAt:task.due_at??'',remainingHours:task.remaining_effort_minutes==null?'':String(task.remaining_effort_minutes/60),leadTimeDays:String(task.lead_time_days??0)};
}
function validDraft(value: unknown): value is TaskDraft {
  return !!value && typeof value === 'object' && draftFields.every(field => typeof (value as TaskDraft)[field] === 'string');
}
function equal(a: TaskDraft, b: TaskDraft) { return draftFields.every(field => a[field] === b[field]); }
function validationError(draft: TaskDraft) {
  if (!draft.title.trim()) return 'Title is required.';
  const hours = Number(draft.remainingHours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 8760) return 'Remaining effort must be between 0 and 8760 hours.';
  const days = Number(draft.leadTimeDays);
  if (!Number.isInteger(days) || days < 0 || days > 3650) return 'Remaining lead time must be a whole number between 0 and 3650 days.';
  return '';
}
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SaveState = { draft: TaskDraft; dirty: boolean; saving: boolean; error: string; recovered: boolean; storageError: boolean };
type Options = { initial: TaskDraft; key: string; storage?: DraftStorage; save: (draft: TaskDraft) => Promise<void>; changed: (state: SaveState) => void };

/** One serialized writer per open task; drafts survive component removal and page reloads. */
export class TaskAutosave {
  private draft: TaskDraft;
  private saved: TaskDraft;
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<boolean>;
  private saving = false;
  private error = '';
  private clientError = '';
  private paused = false;
  private recovered = false;
  private storageError = false;
  private disposed = false;
  constructor(private options: Options) {
    this.draft = {...options.initial};
    this.saved = {...options.initial};
    try {
      const value: unknown = JSON.parse(options.storage?.getItem(options.key) ?? 'null');
      if (validDraft(value) && !equal(value, this.saved)) {
        this.draft = Object.fromEntries(draftFields.map(field => [field, value[field]])) as TaskDraft;
        this.recovered = true;
      }
    } catch { /* A malformed draft must not prevent editing. */ }
    this.emit();
  }
  get pending() { return this.saving || !!this.clientError || !equal(this.draft, this.saved); }
  private emit() {
    if (!this.disposed) this.options.changed({draft:{...this.draft},dirty:!equal(this.draft,this.saved),saving:this.saving,error:this.error,recovered:this.recovered,storageError:this.storageError});
  }
  private persist() {
    try {
      if (!this.options.storage) throw new Error('Storage unavailable');
      if (this.pending) this.options.storage.setItem(this.options.key, JSON.stringify(this.draft));
      else this.options.storage.removeItem(this.options.key);
      this.storageError = false;
    } catch { this.storageError = true; }
  }
  pause() { this.paused = true; clearTimeout(this.timer); }
  update(draft: TaskDraft, immediate = false, clientError = '') {
    this.clientError = clientError;
    this.paused = false;
    this.draft = {...draft};
    this.error = '';
    clearTimeout(this.timer);
    this.persist();
    this.emit();
    if (immediate) void this.flush();
    else if (this.pending) this.timer = setTimeout(() => void this.flush(), 3000);
  }
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.paused) return Promise.resolve(false);
    if (this.clientError) { this.error = this.clientError; this.emit(); return Promise.resolve(false); }
    if (this.flight) return this.flight;
    if (!this.pending) return Promise.resolve(true);
    // Defer work one microtask so even synchronous validation failures clear flight.
    this.flight = Promise.resolve().then(async () => {
      while (!equal(this.draft, this.saved)) {
        const snapshot = {...this.draft};
        if (this.paused) return false;
        this.error = this.clientError || validationError(snapshot);
        if (this.error) { this.emit(); return false; }
        this.saving = true;
        this.emit();
        try {
          await this.options.save(snapshot);
          this.saved = snapshot;
          this.recovered = false;
        } catch (error) {
          this.error = error instanceof Error ? error.message : 'Could not save. Your edits are kept; retry.';
          return false;
        } finally {
          this.saving = false;
          this.persist();
          this.emit();
        }
      }
      return true;
    }).finally(() => { this.flight = undefined; });
    return this.flight;
  }
  dispose() {
    clearTimeout(this.timer);
    this.disposed = true;
    // Do not abort a write already sent to the server. The latest local draft is retained.
  }
}

export type PendingTaskSave = { readonly pending: boolean; flush: () => Promise<boolean> };
export class TaskSaveGroup {
  private editors = new Set<PendingTaskSave>();
  register(editor: PendingTaskSave) { this.editors.add(editor); return () => { this.editors.delete(editor); }; }
  get pending() { return [...this.editors].some(editor => editor.pending); }
  async flush() {
    // An edit can arrive while another editor's request is in flight.
    do {
      const results = await Promise.all([...this.editors].map(editor => editor.flush()));
      if (results.some(result => !result)) return false;
    } while (this.pending);
    return true;
  }
}
