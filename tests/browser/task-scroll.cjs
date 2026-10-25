// Disposable server only: DATABASE_PATH=:memory: npm run dev -- --port 5197
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const prefix=`Scroll ${Date.now()}`;
  for(let i=0;i<40;i++)assert((await page.request.post(origin+'/backlog?/create',{form:{title:`${prefix} ${i}`}})).ok());
  await page.goto(`${origin}/backlog?q=${encodeURIComponent(prefix)}`);await page.waitForLoadState('networkidle');
  const cards=()=>page.locator('[data-backlog-group="unqueued"] article.task-card');
  const targetTitle=await cards().nth(20).locator('button.task-title').innerText();
  const target=page.locator('article.task-card').filter({has:page.getByRole('button',{name:`Edit ${targetTitle}`,exact:true})});
  await target.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-300));
  const before=await page.evaluate(()=>scrollY);assert(before>1000);
  await target.getByRole('checkbox',{name:`Complete ${targetTitle}`,exact:true}).click();
  await page.getByRole('checkbox',{name:`Complete ${targetTitle}`,exact:true}).waitFor({state:'hidden'});await page.waitForLoadState('networkidle');
  const after=await page.evaluate(()=>scrollY);assert(Math.abs(after-before)<200,`Completion lost scroll: ${before} -> ${after}`);
  const movingTitle=await cards().nth(22).locator('button.task-title').innerText();
  const moving=page.locator('article.task-card').filter({has:page.getByRole('button',{name:`Edit ${movingTitle}`,exact:true})});
  await moving.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-300));
  await moving.getByRole('button',{name:`Queue up ${movingTitle}`,exact:true}).click();
  await page.getByRole('button',{name:`Unqueue ${movingTitle}`,exact:true}).waitFor();await page.waitForLoadState('networkidle');
  const box=await moving.boundingBox();assert(box.y>=0&&box.y<700,`Queued task not followed: y=${box.y}`);
  await moving.getByRole('button',{name:`Unqueue ${movingTitle}`,exact:true}).click();await moving.getByRole('button',{name:`Queue up ${movingTitle}`,exact:true}).waitFor();
  const handle=moving.getByRole('button',{name:`Drag ${movingTitle}`,exact:true});await handle.focus();await handle.press('Space');await handle.press('End');await handle.press('Space');await page.waitForLoadState('networkidle');
  await page.waitForFunction(title=>document.querySelector('[data-backlog-group="unqueued"] [data-drag-item]:nth-last-child(2) button.task-title')?.textContent===title,movingTitle);
  const reordered=await moving.boundingBox();assert(reordered.y>=0&&reordered.y<800,`Reordered task not followed: y=${reordered.y}`);
  // A rejected action stays on the same page, showing its error beside the task.
  await moving.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-300));const failureY=await page.evaluate(()=>scrollY);
  const id=await moving.locator('.completion-form input[name="id"]').inputValue();
  await moving.locator('.completion-form input[name="id"]').evaluate(el=>el.value='invalid');
  await moving.getByRole('checkbox').click();await moving.getByRole('alert').waitFor();assert(Math.abs(await page.evaluate(()=>scrollY)-failureY)<100);
  await moving.locator('.completion-form input[name="id"]').evaluate((el,id)=>el.value=id,id);
  // Dirty edits must still save before completion, without a document navigation.
  const editTitle=await cards().nth(20).locator('button.task-title').innerText();
  let editing=page.locator('article.task-card').filter({has:page.getByRole('button',{name:`Edit ${editTitle}`,exact:true})});
  await editing.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-250));await editing.getByRole('button',{name:`Edit ${editTitle}`,exact:true}).click();
  editing=page.locator('article.task-card-expanded');await editing.getByRole('textbox',{name:'Title',exact:true}).fill(editTitle+' saved');
  await editing.getByRole('checkbox').click();await editing.waitFor({state:'hidden'});await page.waitForLoadState('networkidle');assert(await page.evaluate(()=>scrollY)>500);
  await page.locator('.completed-tasks > summary').click();
  await page.getByRole('checkbox',{name:`Mark ${editTitle} saved incomplete`,exact:true}).click();await page.waitForLoadState('networkidle');
  const reopened=page.getByRole('button',{name:`Edit ${editTitle} saved`,exact:true});await reopened.waitFor();const reopenedBox=await reopened.boundingBox();assert(reopenedBox.y>=0&&reopenedBox.y<850);
  // Queue enough tasks to exercise Focus and removal far down Now.
  const profileId=await page.getByRole('combobox',{name:'Active profile'}).first().inputValue();
  const ids=await cards().evaluateAll(els=>els.slice(0,25).map(el=>el.dataset.taskId));
  for(const taskId of ids)assert((await page.request.post(origin+'/backlog?/plan',{form:{taskId,profileId,planned:'true'}})).ok());
  await page.goto(origin+'/now');await page.waitForLoadState('networkidle');
  const focusTarget=page.locator(`[data-task-id="${ids[20]}"]`);await focusTarget.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-300));
  await focusTarget.getByRole('button',{name:'Focus',exact:true}).click();await page.locator(`[data-section="focus"] [data-task-id="${ids[20]}"]`).waitFor();await page.waitForLoadState('networkidle');
  const focused=await focusTarget.boundingBox();assert(focused.y>=0&&focused.y<800,`Focus task not followed: y=${focused.y}`);
  const removing=page.locator(`[data-task-id="${ids[18]}"]`);await removing.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-300));const removeY=await page.evaluate(()=>scrollY);
  await removing.getByRole('button',{name:/^Remove .* from queue$/}).click();await removing.waitFor({state:'hidden'});await page.waitForLoadState('networkidle');assert(Math.abs(await page.evaluate(()=>scrollY)-removeY)<200);
  // The same behavior on mobile, including deletion through its confirmation dialog.
  await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/backlog?q=${encodeURIComponent(prefix)}`);await page.waitForLoadState('networkidle');
  const mobile=page.locator('article.task-card').nth(20);const mobileId=await mobile.getAttribute('data-task-id');
  await mobile.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-250));const mobileY=await page.evaluate(()=>scrollY);
  await mobile.getByRole('checkbox').click();await page.locator(`[data-task-id="${mobileId}"]`).waitFor({state:'hidden'});await page.waitForLoadState('networkidle');assert(Math.abs(await page.evaluate(()=>scrollY)-mobileY)<200);
  const closeTarget=page.locator('article.task-card').nth(18);const closeId=await closeTarget.getAttribute('data-task-id');await closeTarget.locator('button.task-title').click();
  const effort=closeTarget.getByRole('spinbutton',{name:'Remaining effort (hours)',exact:true});await effort.fill('2');await effort.press('Enter');
  await page.locator(`[data-task-id="${closeId}"] button.task-title`).waitFor();const closedBox=await page.locator(`[data-task-id="${closeId}"]`).boundingBox();assert(closedBox.y+closedBox.height>0&&closedBox.y<844);
  const deleting=page.locator('article.task-card').nth(20);const deletingId=await deleting.getAttribute('data-task-id');
  await deleting.locator('button.task-title').click();await deleting.getByRole('button',{name:/^Delete /}).click();
  const deleteY=await page.evaluate(()=>scrollY);const neighbor=page.locator('article.task-card').nth(21);const neighborId=await neighbor.getAttribute('data-task-id');const neighborY=(await neighbor.boundingBox()).y;await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
  await page.locator(`[data-task-id="${deletingId}"]`).waitFor({state:'hidden'});await page.waitForLoadState('networkidle');assert(await page.evaluate(()=>scrollY)>500);const nextY=(await page.locator(`[data-task-id="${neighborId}"]`).boundingBox()).y;assert(Math.abs(nextY-neighborY)<100,`Delete moved neighbor: ${neighborY} -> ${nextY}; scroll ${deleteY} -> ${await page.evaluate(()=>scrollY)}`);
  assert.deepEqual(errors,[]);console.log('Passed: completion, queue/unqueue, reorder, failed action, dirty edits, Focus, removal, mobile completion/deletion preserve scroll or follow the task.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
