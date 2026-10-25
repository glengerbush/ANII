import { error, isActionFailure, isHttpError, isRedirect, json, type Action, type RequestEvent } from '@sveltejs/kit';
import { version } from '../../../../../package.json';
import { activeProfileId } from '$lib/server/profiles';
import { getProfile, getSettings, listProfiles, today, getMessagePage } from '$lib/server/repository';
import * as now from '../../../now/+page.server';
import * as backlog from '../../../backlog/+page.server';
import * as projects from '../../../projects/+page.server';
import * as project from '../../../projects/[id]/+page.server';
import * as calendar from '../../../calendar/+page.server';
import * as completed from '../../../completed/+page.server';
import { actions as settingsActions } from '../../../settings/+page.server';
import { actions as chatActions } from '../../../chat/+page.server';

// JSON transport over the same loaders/actions as the web UI: one source of domain rules.
const views = { now, backlog, projects, project, calendar, completed };
const allowedSettings = ['appearance', 'save', 'createProfile', 'renameProfile', 'deleteProfile', 'testAi'] as const;
function eventFor(event: RequestEvent) {
  return { ...event, params: { ...event.params, id: event.url.searchParams.get('id') ?? '' } };
}
function viewFor(name: string) {
  if (!Object.hasOwn(views, name)) error(404, 'Unknown mobile view.');
  return views[name as keyof typeof views];
}
function failure(cause: unknown) {
  if (isHttpError(cause)) return json({ error: cause.body.message }, { status: cause.status });
  console.error('Mobile API failed', cause);
  return json({ error: 'The server could not finish this request. Try again.' }, { status: 500 });
}
export async function GET(event: RequestEvent) {
  try {
    const view = event.params.view!;
    const context = eventFor(event);
    const before = event.url.searchParams.get('before');
    if (before !== null && (!Number.isSafeInteger(Number(before)) || Number(before) <= 0)) error(400, 'Invalid history cursor.');
    const data = view === 'settings' ? {} : view === 'chat'
      ? getMessagePage(event.url.searchParams.has('before') ? Number(event.url.searchParams.get('before')) : undefined)
      : await (viewFor(view).load as (event: unknown) => unknown)(context);
    return json({ apiVersion: 1, serverVersion: version, currentDate: today(),
      profiles: listProfiles(), activeProfile: getProfile(activeProfileId(event.cookies)), settings: getSettings(), data },
    { headers: { 'cache-control': 'no-store' } });
  } catch (cause) { return failure(cause); }
}
export async function POST(event: RequestEvent) {
  try {
    // Native clients send JSON with a custom header. No CORS opt-in: cross-site forms cannot mutate data.
    if (event.request.headers.get('x-anii-client') !== 'android-v1' || !event.request.headers.get('content-type')?.startsWith('application/json')) {
      error(415, 'Use the ANII JSON client protocol.');
    }
    const raw = await event.request.text();
    if (raw.length > 1_000_000) error(413, 'Request is too large.');
    let body;
    try { body = JSON.parse(raw); } catch { error(400, 'Invalid JSON.'); }
    if (!body || typeof body.action !== 'string' || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) error(400, 'Choose an action and fields.');
    const view = event.params.view!;
    const actions = view === 'settings' ? Object.fromEntries(allowedSettings.map(key => [key, settingsActions[key]]))
      : view === 'chat' ? chatActions : viewFor(view).actions;
    if (!Object.hasOwn(actions, body.action)) error(404, 'Unknown mobile action.');
    const fields = new FormData();
    for (const [key, value] of Object.entries(body.fields)) {
      if (typeof value !== 'string') error(400, 'Action fields must be strings.');
      fields.set(key, value);
    }
    const request = new Request(event.url, { method: 'POST', body: fields,
      headers: { accept: 'application/json', 'x-sveltekit-action': 'true' } });
    const action = (actions as Record<string, Action>)[body.action];
    try {
      const result = await action({ ...eventFor(event), request });
      if (isActionFailure(result)) return json(result.data, { status: result.status });
      return json(result ?? { success: true });
    } catch (cause) {
      // Existing web-only success redirects (e.g. deleting a project/accepting a proposal).
      if (isRedirect(cause) && cause.status === 303) return json({ success: true });
      throw cause;
    }
  } catch (cause) { return failure(cause); }
}
