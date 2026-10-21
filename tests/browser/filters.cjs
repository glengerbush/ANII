// Disposable server only: DATABASE_PATH=:memory: npm run dev -- --port 5197
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const prefix=`Filters ${Date.now()}`,alpha=prefix+' Alpha',beta=prefix+' Beta';
  const navigate=async path=>{await page.goto(origin+path);await page.waitForLoadState('networkidle');};
  for(const title of [alpha,beta])await page.request.post(origin+'/backlog?/create',{form:{title}});
  await page.request.post(origin+'/projects?/create',{form:{name:prefix}});
  await navigate('/backlog');
  const a=await page.getByRole('button',{name:`Drag ${alpha}`,exact:true}).getAttribute('data-drag-handle');
  const b=await page.getByRole('button',{name:`Drag ${beta}`,exact:true}).getAttribute('data-drag-handle');
  const project=await page.getByLabel('Project',{exact:true}).locator('option').filter({hasText:prefix}).getAttribute('value');
  await page.request.post(origin+'/backlog?/addProject',{form:{taskId:a,projectId:project}});
  await page.request.post(origin+'/backlog?/edit',{form:{id:a,title:alpha,dueAt:'2026-12-01'}});
  await page.request.post(origin+'/backlog?/dependency',{form:{taskId:a,prerequisiteId:b}});
  await navigate('/backlog');
  const search=page.getByRole('searchbox',{name:'Search',exact:true});
  const waitFilter=(key,value)=>page.waitForFunction(({key,value})=>new URL(location.href).searchParams.get(key)===value&&document.querySelector('.backlog-filters')?.getAttribute('aria-busy')==='false',{key,value});
  assert.equal(await page.getByRole('button',{name:'Apply filters',exact:true}).count(),0);assert.equal(await page.locator('.clear-filter').count(),0);
  await search.fill(prefix);await waitFilter('q',prefix);
  await page.getByLabel('Project',{exact:true}).selectOption(project);await waitFilter('project',project);
  await page.getByLabel('State',{exact:true}).selectOption('blocked');await waitFilter('state','blocked');
  await page.getByLabel('Due',{exact:true}).selectOption('1');await waitFilter('due','1');
  assert.equal(await page.locator('.clear-filter').count(),4);await page.getByRole('button',{name:`Edit ${alpha}`,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:`Edit ${beta}`,exact:true}).count(),0);
  await page.getByRole('button',{name:'Clear project filter',exact:true}).click();await waitFilter('project',null);
  assert.equal(new URL(page.url()).searchParams.get('state'),'blocked');assert.equal(new URL(page.url()).searchParams.get('q'),prefix);
  await page.getByRole('button',{name:'Clear state filter',exact:true}).click();await waitFilter('state',null);
  await page.getByRole('button',{name:'Clear due filter',exact:true}).click();await waitFilter('due',null);
  await page.getByRole('button',{name:`Edit ${beta}`,exact:true}).waitFor();
  // A newer search must survive the result of an older request.
  let release;let intercepted;let first=true;const started=new Promise(resolve=>intercepted=resolve);
  await page.route('**/backlog/__data.json*',async route=>{if(!first)return route.continue();first=false;intercepted();await new Promise(resolve=>release=resolve);await route.continue();});
  await search.fill(alpha);await started;await search.fill(beta);release();await waitFilter('q',beta);await page.unroute('**/backlog/__data.json*');
  assert.equal(await search.inputValue(),beta);await page.getByRole('button',{name:`Edit ${beta}`,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:`Edit ${alpha}`,exact:true}).count(),0);
  // Filter navigation flushes open task edits first.
  await page.getByRole('button',{name:`Edit ${beta}`,exact:true}).click();await page.getByLabel('Notes',{exact:true}).fill('Saved before filtering');
  await search.fill(alpha);await waitFilter('q',alpha);
  await search.fill(beta);await waitFilter('q',beta);await page.getByRole('button',{name:`Edit ${beta}`,exact:true}).click();assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Saved before filtering');
  await page.getByRole('button',{name:`Close ${beta}`,exact:true}).click();await page.getByRole('button',{name:'Clear search',exact:true}).click();await waitFilter('q',null);assert.equal(await page.locator('.clear-filter').count(),0);
  await page.getByLabel('Project',{exact:true}).selectOption(project);await waitFilter('project',project);
  await page.screenshot({path:'/tmp/anii-filters-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/anii-filters-mobile.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Clear project filter',exact:true}).click();await waitFilter('project',null);
  assert.deepEqual(errors,[]);console.log('Passed: automatic filters, individual clearing, latest search wins, autosave before filtering, mobile.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
