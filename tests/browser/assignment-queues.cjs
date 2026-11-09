// Run only against the disposable in-memory server.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const title=`Assignment ${Date.now()}`,otherName=`Other ${Date.now()}`;
  await page.request.post(origin+'/profile',{form:{intent:'create',name:otherName,returnTo:'/backlog'}});
  const state=await (await page.request.get(origin+'/api/mobile/backlog')).json();
  const owner=state.activeProfile.id,other=state.profiles.find(p=>p.name===otherName).id;
  await page.request.post(origin+'/backlog?/create',{form:{title}});
  const list=await (await page.request.get(origin+'/api/mobile/backlog')).json();const id=list.data.tasks.find(t=>t.title===title).id;
  await page.request.post(origin+'/backlog?/plan',{form:{taskId:String(id),planned:'true'}});
  await page.goto(origin+'/backlog');await page.waitForLoadState('networkidle');
  const card=page.locator(`[data-task-id="${id}"]`);
  await card.getByRole('button',{name:`Edit ${title}`,exact:true}).click();
  await card.locator('select[name=assigneeId]').selectOption(String(other));
  // Selecting the assignee must save without a separate schedule submission.
  await card.getByRole('button',{name:`Queue up ${title}`,exact:true}).waitFor();
  async function queued(profile){const result=await (await page.request.get(origin+'/api/mobile/now',{headers:{cookie:`life_profile=${profile}`}})).json();return result.data.tasks.some(t=>t.id===id);}
  assert.equal(await queued(owner),false);assert.equal(await queued(other),true);
  async function open(){if(await card.getByRole('button',{name:`Edit ${title}`,exact:true}).count())await card.getByRole('button',{name:`Edit ${title}`,exact:true}).click();}
  async function assign(value){await open();const saved=page.waitForResponse(r=>r.url().includes('?/schedule')&&r.request().method()==='POST');await card.locator('select[name=assigneeId]').selectOption(value);assert((await saved).ok());await page.waitForLoadState('networkidle');}
  await assign('everyone');assert.equal(await queued(owner),true);assert.equal(await queued(other),true);
  await card.getByRole('button',{name:`Unqueue ${title}`,exact:true}).click();await card.getByRole('button',{name:`Queue up ${title}`,exact:true}).waitFor();
  assert.equal(await queued(owner),false);assert.equal(await queued(other),true);
  await open();assert.equal(await card.locator('select[name=assigneeId]').inputValue(),'everyone');
  await assign('none');assert.equal(await queued(owner),false);assert.equal(await queued(other),false);
  await assign(String(other));assert.equal(await queued(other),true);assert.equal(await queued(owner),false);
  await card.getByRole('button',{name:`Queue up ${title}`,exact:true}).click();await card.getByRole('button',{name:`Unqueue ${title}`,exact:true}).waitFor();
  assert.equal(await queued(owner),true);assert.equal(await queued(other),true);
  await open();assert.equal(await card.locator('select[name=assigneeId]').inputValue(),'everyone');
  assert.deepEqual(errors,[]);console.log('Passed: immediate assignment, transfer, Everyone, No one, personal dismissal, and Queue up sharing.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
