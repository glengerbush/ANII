// Disposable server only: DATABASE_PATH=:memory: npm run dev -- --port 5197
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const prefix=`Review ${Date.now()}`,assigned=prefix+' assigned',unassigned=prefix+' unassigned';
  const navigate=async path=>{await page.goto(origin+path);await page.waitForLoadState('networkidle');};
  await page.request.post(origin+'/projects?/create',{form:{name:prefix}});await navigate('/projects');
  const path=await page.getByRole('link',{name:prefix,exact:true}).getAttribute('href');
  await page.request.post(origin+path+'?/create',{form:{title:assigned}});await page.request.post(origin+'/backlog?/create',{form:{title:unassigned}});
  await navigate('/backlog');const taskId=await page.getByRole('button',{name:`Drag ${assigned}`,exact:true}).getAttribute('data-drag-handle');
  const profileId=await page.getByRole('combobox',{name:'Active profile'}).first().inputValue();
  await page.getByLabel('Project',{exact:true}).selectOption('none');await page.waitForURL('**/backlog?project=none');await page.waitForLoadState('networkidle');
  await page.getByRole('button',{name:`Edit ${unassigned}`,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:`Edit ${assigned}`,exact:true}).count(),0);
  await page.reload();await page.waitForLoadState('networkidle');assert.equal(await page.getByLabel('Project',{exact:true}).inputValue(),'none');
  await navigate('/projects');assert.equal(await page.getByRole('button',{name:'Mark complete',exact:true}).count(),0);assert.equal(await page.locator('.project-card input[type="checkbox"]').count(),0);
  await page.getByRole('link',{name:prefix,exact:true}).click();await page.waitForLoadState('networkidle');
  const complete=page.getByRole('button',{name:'Mark complete',exact:true});
  const titleBounds=await page.getByRole('heading',{name:prefix,exact:true}).boundingBox(),buttonBounds=await complete.boundingBox();assert(buttonBounds.x>titleBounds.x+titleBounds.width);
  await page.screenshot({path:'/tmp/anii-project-complete-button.png'});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/anii-project-complete-mobile.png'});await page.setViewportSize({width:1440,height:1000});
  await complete.click();await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'Reopen project',exact:true}).waitFor();await navigate('/projects');
  const history=page.locator('.completed-projects');await history.locator(':scope > summary').waitFor();assert.equal(await history.getAttribute('open'),null);await history.locator(':scope > summary').click();
  assert.equal(await page.getByRole('button',{name:'Reopen project',exact:true}).count(),0);await page.screenshot({path:'/tmp/anii-completed-projects.png'});
  await history.getByRole('link',{name:prefix,exact:true}).click();await page.waitForLoadState('networkidle');await page.getByRole('button',{name:`Edit ${assigned}`,exact:true}).waitFor();
  await page.getByRole('button',{name:'Reopen project',exact:true}).click();await page.waitForLoadState('networkidle');await complete.waitFor();
  await complete.click();await page.waitForLoadState('networkidle');await navigate('/projects');await history.locator(':scope > summary').click();await history.getByRole('link',{name:prefix,exact:true}).waitFor();
  await navigate('/calendar?view=week');assert.equal(await page.locator('.calendar-day.weekend').count(),2);assert.equal(await page.locator('.weekday.weekend').count(),2);
  const weekend=await page.locator('.calendar-day.weekend').first().evaluate(el=>getComputedStyle(el).backgroundColor),weekday=await page.locator('.calendar-day:not(.weekend)').first().evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(weekend,weekday);
  await navigate('/calendar?view=month');assert((await page.locator('.calendar-day.weekend').count())>=8);await page.screenshot({path:'/tmp/anii-calendar-weekends.png'});
  await page.request.post(origin+'/backlog?/edit',{form:{id:taskId,title:assigned,dueAt:'2000-01-01'}});await page.request.post(origin+'/backlog?/plan',{form:{taskId,profileId,planned:'true'}});
  await navigate('/now');const warnings=page.getByRole('region',{name:'Automatic warnings'});await warnings.waitFor();await page.getByRole('button',{name:'Dismiss needs attention',exact:true}).click();await warnings.waitFor({state:'hidden'});
  await page.reload();await page.waitForLoadState('networkidle');assert.equal(await warnings.count(),0);
  await page.request.post(origin+'/backlog?/edit',{form:{id:taskId,title:assigned+' changed',dueAt:'2000-01-01'}});await page.reload();await page.waitForLoadState('networkidle');await warnings.waitFor();
  await page.route('**/now/check',route=>route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'done',result:{checked:true,dueTasks:[],startWarnings:[],concerns:[{taskId:Number(taskId),observation:'Review this task',reason:'Test concern',choices:['Keep','Move']}]}})+'\n'}));
  await page.getByRole('button',{name:'Check plan',exact:true}).click();await page.getByText('Review this task',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Dismiss plan check',exact:true}).click();await page.getByText('Review this task',{exact:true}).waitFor({state:'hidden'});assert.equal(await page.locator('.ai-activity').count(),0);assert.equal(await page.getByRole('region',{name:'Due tasks missing from Now'}).count(),0);
  await page.getByRole('button',{name:'Check plan',exact:true}).click();await page.getByText('Review this task',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/anii-dismissible-now-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('Passed: None filter/reload, project completion/history/reopen/task preservation, week/month weekends, warning dismissal persistence/updates, plan dismissal/rerun, mobile.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
