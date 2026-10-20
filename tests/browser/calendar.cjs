// Disposable server only: DATABASE_PATH=:memory: npm run dev -- --port 5197
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  async function navigate(url){await page.goto(url);await page.waitForLoadState('networkidle');}
  const suffix=Date.now();const mine=`Calendar mine ${suffix}`,shared=`Calendar shared ${suffix}`,theirs=`Calendar assigned ${suffix}`,unscheduled=`Calendar unscheduled ${suffix}`;
  for(const title of [mine,shared,theirs,unscheduled])assert((await page.request.post(`${origin}/backlog?/create`,{form:{title}})).ok());
  assert((await page.request.post(`${origin}/settings?/createProfile`,{form:{name:`Calendar colleague ${suffix}`}})).ok());
  await navigate(`${origin}/calendar`);await page.waitForLoadState('networkidle');
  const profile=page.getByRole('combobox',{name:'Active profile'}).first();
  const other=await profile.locator('option').filter({hasText:`Calendar colleague ${suffix}`}).getAttribute('value');
  
  const day=page.locator('.current-day .day-space');const modal=page.getByRole('dialog');
  async function search(title){const box=await day.boundingBox();await day.click({position:{x:8,y:box.height-8}});await page.getByRole('searchbox',{name:'Search tasks'}).fill(title);await page.getByRole('button',{name:new RegExp(`Schedule ${title}`)}).waitFor();}
  async function saved(click){const response=page.waitForResponse(r=>r.url().includes('?/schedule'));await click();assert((await response).ok());await modal.waitFor({state:'hidden'});}
  await search(mine);await page.screenshot({path:'/tmp/anii-calendar-picker.png',fullPage:true});assert.equal(await modal.locator('.result').count(),1);
  assert(await page.getByRole('searchbox',{name:'Search tasks'}).evaluate(el=>document.activeElement===el));
  await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.matches('.current-day .day-space')); 
  await search(mine);await page.route('**/calendar?/schedule',route=>route.abort());
  await modal.locator('.select-task').click();await modal.getByRole('alert').filter({hasText:'Check your connection'}).waitFor();
  await page.unroute('**/calendar?/schedule');await saved(()=>modal.locator('.select-task').click());
  await page.locator('.current-day').getByRole('button',{name:new RegExp(`Edit schedule for ${mine}`)}).waitFor();
  await search(shared);await modal.getByRole('button',{name:new RegExp(`Assign ${shared}`)}).click();await saved(()=>modal.getByRole('button',{name:'Everyone',exact:true}).click());
  await search(theirs);await modal.getByRole('button',{name:new RegExp(`Assign ${theirs}`)}).click();await saved(()=>modal.getByRole('button',{name:`Calendar colleague ${suffix}`,exact:true}).click());
  assert.equal(await page.locator('.scheduled-task').filter({hasText:theirs}).count(),0,'Current profile filter excludes another user');
  await page.getByRole('combobox',{name:'Show scheduled tasks for'}).selectOption('all');await page.locator('.scheduled-task').filter({hasText:theirs}).waitFor();
  await page.getByRole('link',{name:'Week',exact:true}).click();await page.locator('.calendar-grid.week').waitFor();assert.equal(await page.locator('.calendar-day').count(),7);
  await page.screenshot({path:'/tmp/anii-calendar-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'Month',exact:true}).click();await page.locator('.calendar-grid.month').waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/anii-calendar-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Page must not overflow at mobile width');
  await page.setViewportSize({width:1440,height:1000});
  await navigate(`${origin}/now`);await page.getByRole('button',{name:`Edit ${mine}`,exact:true}).waitFor();await page.getByRole('button',{name:`Edit ${shared}`,exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:`Edit ${theirs}`,exact:true}).count(),0);
  await page.getByRole('button',{name:`Remove ${mine} from queue`,exact:true}).click();await page.getByRole('button',{name:`Edit ${mine}`,exact:true}).waitFor({state:'hidden'});
  await page.reload();assert.equal(await page.getByRole('button',{name:`Edit ${mine}`,exact:true}).count(),0,'Hide survives reload');
  await navigate(`${origin}/backlog`);await page.waitForLoadState('networkidle');
  assert(await page.getByRole('searchbox',{name:'Search',exact:true}).isVisible());assert.equal(await page.getByText('Search and filters',{exact:true}).count(),0);
  const card=page.locator('article.task-card').filter({has:page.getByRole('button',{name:`Edit ${mine}`,exact:true})});
  await card.getByRole('button',{name:`Queue up ${mine}`,exact:true}).click();await card.getByRole('button',{name:`Unqueue ${mine}`,exact:true}).filter({hasText:'Queued up'}).waitFor();
  await navigate(`${origin}/calendar`);await page.waitForLoadState('networkidle');
  await page.locator('.scheduled-task').filter({hasText:mine}).click();
  const start=await modal.getByLabel('Start date').inputValue();const future=new Date(`${start}T12:00:00Z`);future.setUTCDate(future.getUTCDate()+7);const later=future.toISOString().slice(0,10);
  await modal.getByLabel('Start date').fill(later);await saved(()=>modal.getByRole('button',{name:'Save',exact:true}).click());
  await navigate(`${origin}/now`);assert.equal(await page.getByRole('button',{name:`Edit ${mine}`,exact:true}).count(),0,'Future date removes task from Now');
  await navigate(`${origin}/calendar?date=${later}`);await page.locator('.scheduled-task').filter({hasText:mine}).click();
  await modal.getByRole('button',{name:'Remove schedule',exact:true}).click();await modal.waitFor({state:'hidden'});
  await navigate(`${origin}/backlog`);await page.getByRole('button',{name:`Edit ${mine}`,exact:true}).waitFor();
  await page.waitForLoadState('networkidle');
  const switched=page.waitForResponse(r=>r.url().endsWith('/profile')&&r.request().method()==='POST');
  await page.getByRole('combobox',{name:'Active profile'}).first().selectOption(other);assert.equal((await switched).status(),303);await page.waitForLoadState('networkidle');
  await navigate(`${origin}/now`);await page.getByRole('button',{name:`Edit ${shared}`,exact:true}).waitFor();await page.getByRole('button',{name:`Edit ${theirs}`,exact:true}).waitFor();
  await navigate(`${origin}/calendar`);assert.equal(await page.getByRole('combobox',{name:'Show scheduled tasks for'}).inputValue(),other);
  assert.deepEqual(errors,[]);console.log('Calendar browser flow passed: search, assignments, filters, week/month, hide/re-add, reschedule/unschedule, mobile.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
