// Run against a disposable dev server: DATABASE_PATH=:memory: npm run dev -- --port 5197
// Then: node tests/browser/plan-suggestions.cjs (requires Playwright + Chromium).
// NODE_PATH may point to a bundled Playwright installation.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const profileName=`Suggestions ${Date.now()}`;
    await page.request.post(`${origin}/settings?/createProfile`,{form:{name:profileName}});
    await page.goto(`${origin}/now`);
    const profileId=await page.getByRole('combobox',{name:'Active profile'}).first().locator('option').filter({hasText:profileName}).getAttribute('value');
    await page.request.post(`${origin}/profile`,{form:{profileId}});
    for(const title of ['First suggestion','Second suggestion','Third suggestion','Missing deadline','Start early']){
      const response=await page.request.post(`${origin}/now?/quickAdd`,{form:{title,profileId}});
      assert(response.ok());
    }
    await page.goto(`${origin}/now`);
    await page.waitForLoadState('networkidle');
    const allIds=await page.locator('[data-drag-handle]').evaluateAll(elements=>elements.map(element=>Number(element.dataset.dragHandle)));
    assert.equal(allIds.length,5);
    const ids=allIds.slice(0,3),dueId=allIds[3],startId=allIds[4];
    const date=await page.locator('form[action="?/sanity"] input[name="planDate"]').inputValue();
    const tomorrow=new Date(`${date}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const nextDate=tomorrow.toISOString().slice(0,10);
    for(const [id,title,dueAt] of [[dueId,'Missing deadline',date],[startId,'Start early',nextDate]]){
      assert((await page.request.post(`${origin}/now?/edit`,{form:{id:String(id),title,dueAt,duration:'15m'}})).ok());
      assert((await page.request.post(`${origin}/now?/remove`,{form:{id:String(id),profileId,planDate:date}})).ok());
    }
    await page.reload();await page.waitForLoadState('networkidle');
    // Fix only model output; all choice submissions use the real route and database.
    await page.route('**/now/check',route=>route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'done',result:{checked:true,
      dueTasks:[{id:dueId,title:'Missing deadline',due_at:date}],
      startWarnings:[{taskId:startId,title:'Start early',dueAt:nextDate,startBy:date,effortMinutes:15,workDays:1,leadDays:0,bufferDays:2,prerequisites:[],incompleteEstimates:[],planned:false}],
      concerns:ids.map((taskId,i)=>({taskId,basis:'deadline',observation:`Concern ${i+1}`,reason:'A task-specific scheduling conflict',choices:['Keep','Move']}))
    }})+'\n'}));
    await page.getByRole('button',{name:'Check plan',exact:true}).click();
    const suggestions=page.getByRole('region',{name:'Sanity check concerns'});
    await suggestions.getByText('Concern 3',{exact:true}).waitFor();
    assert.equal(await suggestions.getByText('First suggestion',{exact:true}).count(),1,'Suggestions identify their task');
    async function choose(button){
      const saved=page.waitForResponse(response=>response.url().includes('?/concern'));
      await button.click();await (await saved).finished();
      await page.waitForLoadState('networkidle');
      // Reenabled buttons mean the result callback and data refresh both finished.
      await page.waitForFunction(()=>!document.querySelector('form[action="?/sanity"] button').disabled);
    }
    await choose(suggestions.getByRole('button',{name:'Keep',exact:true}).first());
    assert.equal(await suggestions.locator('article').count(),2,'Keep must preserve unrelated suggestions');
    assert.equal(await page.locator(`[data-drag-handle="${ids[0]}"]`).count(),1,'Keep retains the task in Now');
    for(const [name,id] of [['Due tasks missing from Now',dueId],['Future deadlines to start now',startId]]){
      await choose(page.getByRole('region',{name}).locator(`form:has(input[name="taskId"][value="${id}"])`).getByRole('button',{name:'Queue up',exact:true}));
      assert.equal(await suggestions.locator('article').count(),2,'Add/Start must preserve AI suggestions');
    }
    assert.equal(await page.locator(`[data-drag-handle="${dueId}"]`).count(),1);
    assert.equal(await page.locator(`[data-drag-handle="${startId}"]`).count(),1);
    const choiceUrl=url=>url.pathname==='/now'&&url.search==='?/concern';
    await page.route(choiceUrl,route=>route.abort());
    await suggestions.getByRole('button',{name:'Keep',exact:true}).first().click();
    await page.getByRole('alert').filter({hasText:'Could not save your choice'}).waitFor();
    assert.equal(await suggestions.locator('article').count(),2,'Network failures must preserve every suggestion');
    await page.unroute(choiceUrl);
    const keepForm=suggestions.locator('form').first();
    await keepForm.locator('[name="profileId"]').evaluate(input=>input.value='999999999');
    await choose(keepForm.getByRole('button',{name:'Keep',exact:true}));
    assert.equal(await suggestions.locator('article').count(),2,'Failed saves must preserve every suggestion');
    await page.getByRole('alert').filter({hasText:'profile changed'}).waitFor();
    await keepForm.locator('[name="profileId"]').evaluate((input,id)=>input.value=id,profileId);
    await choose(suggestions.getByRole('button',{name:'Move',exact:true}).first());
    assert.equal(await suggestions.locator('article').count(),1,'Move resolves only one suggestion');
    assert.equal(await suggestions.getByText('Concern 3',{exact:true}).count(),1);
    assert.equal(await page.locator(`[data-drag-handle="${ids[1]}"]`).count(),0,'Move removes only its task from Now');
    assert.equal(await page.getByRole('alert').count(),0,'A successful retry clears the error');
    await choose(suggestions.getByRole('button',{name:'Keep',exact:true}));
    assert.equal(await suggestions.count(),0);
    await page.getByText('All plan suggestions reviewed.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: task names; Keep/Move resolve individually; Add/Start preserve suggestions; failed saves retain suggestions; real plan mutations; no browser errors');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
