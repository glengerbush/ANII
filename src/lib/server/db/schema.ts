import { integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(), color: text('color'),
  state: text('state', { enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
});
export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }), title: text('title').notNull(),
  details: text('details').notNull().default(''), state: text('state', { enum: ['open','waiting','completed','dropped'] }).notNull().default('open'),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  durationBucket: text('duration_bucket', { enum: ['15m','30m','1h','2h+'] }), dueAt: text('due_at'),
  remainingEffortMinutes: integer('remaining_effort_minutes'), leadTimeDays: integer('lead_time_days').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`), completedAt: text('completed_at')
});
export const taskProjects = sqliteTable('task_projects', {
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (t) => [primaryKey({ columns: [t.taskId, t.projectId] })]);
export const profiles = sqliteTable('profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }), name: text('name').notNull().unique(),
  color: text('color'), createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
});
export const dailyPlans = sqliteTable('daily_plans', {
  profileId: integer('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  planDate: text('plan_date').notNull(), taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  section: text('section', { enum: ['focus','also'] }).notNull(), position: integer('position').notNull().default(0), reviewOutcome: text('review_outcome')
}, (t) => [primaryKey({ columns: [t.profileId, t.planDate, t.taskId] }), unique().on(t.profileId, t.planDate, t.section, t.position)]);
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }), role: text('role', { enum: ['user','assistant'] }).notNull(), content: text('content').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`), model: text('model'), promptVersion: text('prompt_version')
});
export const dependencies = sqliteTable('dependencies', {
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  prerequisiteTaskId: integer('prerequisite_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }), kind: text('kind', { enum: ['hard','soft'] }).notNull(),
  sourceMessageId: integer('source_message_id').references(() => messages.id, { onDelete: 'set null' }), confidence: real('confidence'), createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
}, (t) => [primaryKey({ columns: [t.taskId, t.prerequisiteTaskId] })]);
export const aiProposals = sqliteTable('ai_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }), messageId: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), schemaVersion: integer('schema_version').notNull().default(1), payload: text('payload').notNull(),
  status: text('status', { enum: ['pending','accepted','rejected','superseded'] }).notNull().default('pending'), confidence: real('confidence'), rationale: text('rationale'),
  model: text('model'), promptVersion: text('prompt_version'), createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`), resolvedAt: text('resolved_at'), resultType: text('result_type'), resultId: integer('result_id')
});
export const events = sqliteTable('events', { id: integer('id').primaryKey({ autoIncrement: true }), entityType: text('entity_type').notNull(), entityId: integer('entity_id'), eventType: text('event_type').notNull(), data: text('data').notNull().default('{}'), createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`) });
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull(), updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`) });
export const reviews = sqliteTable('reviews', { id: integer('id').primaryKey({ autoIncrement: true }), reviewDate: text('review_date').notNull(), profileId: integer('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }), closedAt: text('closed_at').notNull().default(sql`CURRENT_TIMESTAMP`) });
export const reviewSessions = sqliteTable('review_sessions', { id: integer('id').primaryKey({ autoIncrement: true }), profileId: integer('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }), reviewDate: text('review_date').notNull(), tomorrowDate: text('tomorrow_date').notNull(), stage: text('stage', { enum: ['plan','focus','done'] }).notNull(), startedAt: text('started_at').notNull().default(sql`CURRENT_TIMESTAMP`), completedAt: text('completed_at') }, (t)=>[unique().on(t.profileId,t.reviewDate)]);
