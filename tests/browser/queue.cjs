// Run against a disposable server: DATABASE_PATH=:memory: npm run dev -- --port 5197
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const prefix=`Ordering ${Date.now()}`;
  const names=[`${prefix} show A`,`${prefix} hidden B`,`${prefix} show C`,`${prefix} hidden D`];const [a,b,c,d]=names;
  const navigate=async path=>{await page.goto(`${origin}${path}`);await page.waitForLoadState('networkidle');};
  for(const title of names)assert((await page.request.post(`${origin}/backlog?/create`,{form:{title}})).ok());
  await navigate(`/backlog?q=${encodeURIComponent(prefix)}`);
  const backlogGroup=group=>page.locator(`[data-backlog-group="${group}"]`);
  const order=async locator=>(await locator.locator('[data-drag-handle]').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label').slice(5)))).filter(title=>title.startsWith(prefix));
  async function expectOrder(locator,expected){await page.waitForFunction(({selector,prefix,expected})=>JSON.stringify([...document.querySelectorAll(selector+' [data-drag-handle]')].map(el=>el.getAttribute('aria-label').slice(5)).filter(title=>title.startsWith(prefix)))===JSON.stringify(expected),{selector:locator,prefix,expected});}
  async function toggle(title,queued){await page.getByRole('button',{name:`${queued?'Queue up':'Unqueue'} ${title}`,exact:true}).click();await page.getByRole('button',{name:`${queued?'Unqueue':'Queue up'} ${title}`,exact:true}).waitFor();}
  async function keyboardMove(title,key){const handle=page.getByRole('button',{name:`Drag ${title}`,exact:true});await handle.focus();await handle.press('Space');await handle.press(key);await handle.press('Space');}
  assert.deepEqual(await order(backlogGroup('unqueued')),[d,c,b,a]);
  for(const title of [a,b,c])await toggle(title,true);
  await expectOrder('[data-backlog-group="queued"]',[a,b,c]);
  await keyboardMove(c,'Home');await expectOrder('[data-backlog-group="queued"]',[c,a,b]);
  await navigate('/now');await expectOrder('[data-section="also"][data-drop-section]',[c,a,b]);
  await keyboardMove(b,'ArrowUp');await expectOrder('[data-section="also"][data-drop-section]',[c,b,a]);
  await navigate(`/backlog?q=${encodeURIComponent(prefix)}`);await expectOrder('[data-backlog-group="queued"]',[c,b,a]);
  await toggle(b,false);await expectOrder('[data-backlog-group="unqueued"]',[b,d]);
  // Pointer reorder of the unqueued group.
  const source=page.getByRole('button',{name:`Drag ${d}`,exact:true}),target=page.locator('[data-drag-item]').filter({has:page.getByRole('button',{name:`Drag ${b}`,exact:true})});
  await source.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();const s=await source.boundingBox(),t=await target.boundingBox();
  await page.mouse.move(s.x+s.width/2,s.y+s.height/2);await page.mouse.down();await page.mouse.move(t.x+20,t.y+5,{steps:12});await page.mouse.up();
  await expectOrder('[data-backlog-group="unqueued"]',[d,b]);
  await toggle(b,true);await expectOrder('[data-backlog-group="queued"]',[c,a,b]);
  // A/C are visible; B must keep its position relative to other filtered-out tasks.
  await navigate(`/backlog?q=${encodeURIComponent(prefix+' show')}`);await keyboardMove(a,'Home');await expectOrder('[data-backlog-group="queued"]',[a,c]);
  await navigate(`/backlog?q=${encodeURIComponent(prefix)}`);await expectOrder('[data-backlog-group="queued"]',[a,c,b]);
  await navigate('/now');await keyboardMove(a,'ArrowLeft');await page.locator('[data-section="focus"][data-drop-section]').getByRole('button',{name:`Edit ${a}`,exact:true}).waitFor();
  await page.getByRole('button',{name:`Edit ${a}`,exact:true}).click();
  const card=page.locator('article.task-card').filter({has:page.getByRole('button',{name:`Edit ${a}`,exact:true})});
  await card.getByRole('button',{name:'Save schedule',exact:true}).click();await page.waitForLoadState('networkidle');
  assert(await page.locator('[data-section="focus"][data-drop-section]').getByRole('button',{name:`Edit ${a}`,exact:true}).isVisible());
  await navigate(`/backlog?q=${encodeURIComponent(prefix)}`);await page.screenshot({path:'/tmp/anii-backlog-queue-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/anii-backlog-queue-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.setViewportSize({width:1440,height:1100});
  // Completed Calendar entries expose a truthful read-only schedule.
  await page.getByRole('checkbox',{name:`Complete ${c}`,exact:true}).click();await page.getByRole('checkbox',{name:`Complete ${c}`,exact:true}).waitFor({state:'hidden'});
  await navigate('/calendar');await page.locator('.scheduled-task').filter({hasText:c}).click();const dialog=page.getByRole('dialog');
  await dialog.getByText('Completed task schedule',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Save',exact:true}).count(),0);
  assert(await dialog.getByRole('button',{name:'Remove schedule',exact:true}).isVisible());
  // Another profile has an independent order and no personal assignments from this test.
  const second=await browser.newPage();await second.request.post(`${origin}/settings?/createProfile`,{form:{name:prefix}});
  await second.goto(`${origin}/backlog`);await second.waitForLoadState('networkidle');const select=second.getByRole('combobox',{name:'Active profile'}).first();const other=await select.locator('option').filter({hasText:prefix}).getAttribute('value');
  await second.request.post(`${origin}/profile`,{form:{profileId:other,returnTo:'/backlog'}});
  await second.goto(`${origin}/backlog?q=${encodeURIComponent(prefix)}`);await second.waitForLoadState('networkidle');
  assert.equal(await second.locator('[data-backlog-group="queued"] [data-drag-handle]').count(),0);
  const independent=await second.locator('[data-backlog-group="unqueued"] [data-drag-handle]').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label').slice(5)));
  assert.deepEqual(independent,[d,b,a]);
  assert.deepEqual(errors,[]);console.log('Queue browser flow passed: personal ordering, queue/unqueue, keyboard/pointer, shared Now order, filtering, Focus preservation, completed calendar, mobile.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
