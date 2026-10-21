// Disposable server only: DATABASE_PATH=:memory: npm run dev -- --port 5197
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const prefix=`Project order ${Date.now()}`,names=['A','B','C'].map(name=>`${prefix} ${name}`),[a,b,c]=names;
  const navigate=async path=>{await page.goto(origin+path);await page.waitForLoadState('networkidle');};
  for(const name of [prefix,prefix+' other'])assert((await page.request.post(origin+'/projects?/create',{form:{name}})).ok());
  await navigate('/projects');const projectLink=page.getByRole('link',{name:prefix,exact:true}),path=await projectLink.getAttribute('href');
  const otherPath=await page.getByRole('link',{name:prefix+' other',exact:true}).getAttribute('href');
  const card=page.locator('.project-card').filter({has:projectLink}),heading=card.getByRole('heading',{name:prefix,exact:true});
  const color=await heading.evaluate(el=>getComputedStyle(el).color),background=await card.evaluate(el=>getComputedStyle(el).backgroundColor);
  await projectLink.hover();assert.equal(await heading.evaluate(el=>getComputedStyle(el).color),color);assert.notEqual(await card.evaluate(el=>getComputedStyle(el).backgroundColor),background);
  for(const title of names)assert((await page.request.post(origin+path+'?/create',{form:{title}})).ok());
  await navigate(path);
  const order=async()=>await page.locator('[data-drag-handle]').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label').slice(5)));
  const waitOrder=expected=>page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('[data-drag-handle]')].map(el=>el.getAttribute('aria-label').slice(5)))===JSON.stringify(expected),expected);
  const move=async(title,key)=>{const handle=page.getByRole('button',{name:`Drag ${title}`,exact:true});await handle.focus();await handle.press('Space');await handle.press(key);await handle.press('Space');};
  assert.deepEqual(await order(),names);
  for(const title of names){
   const taskId=await page.getByRole('button',{name:`Drag ${title}`,exact:true}).getAttribute('data-drag-handle');
   assert((await page.request.post(origin+path+'?/addProject',{form:{taskId,projectId:otherPath.split('/').at(-1)}})).ok());
   await page.getByRole('button',{name:`Queue up ${title}`,exact:true}).click();await page.getByRole('button',{name:`Unqueue ${title}`,exact:true}).waitFor();
  }
  await move(c,'Home');await waitOrder([c,a,b]);await navigate(path);assert.deepEqual(await order(),[c,a,b]);
  await navigate(otherPath);assert.deepEqual(await order(),names);
  await navigate('/now');assert.deepEqual((await page.locator('[data-section="also"] [data-drag-handle]').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label').slice(5)))).filter(name=>name.startsWith(prefix)),names);
  await navigate(path);
  const source=await page.getByRole('button',{name:`Drag ${b}`,exact:true}).boundingBox();const target=await page.locator('[data-drag-item]').filter({has:page.getByRole('button',{name:`Drag ${c}`,exact:true})}).boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+20,target.y+5,{steps:12});await page.mouse.up();await waitOrder([b,c,a]);
  const context=await browser.newContext();const second=await context.newPage();await second.request.post(origin+'/settings?/createProfile',{form:{name:prefix}});
  await second.goto(origin+path);await second.waitForLoadState('networkidle');const id=await second.getByRole('combobox',{name:'Active profile'}).first().locator('option').filter({hasText:prefix}).getAttribute('value');
  await second.request.post(origin+'/profile',{form:{profileId:id,returnTo:path}});await second.goto(origin+path);await second.waitForLoadState('networkidle');
  assert.deepEqual(await second.locator('[data-drag-handle]').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label').slice(5))),[b,c,a]);
  await page.screenshot({path:'/tmp/anii-project-order-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/anii-project-order-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('Passed: whole-card hover, keyboard/pointer project ordering, persistence, shared profiles, independent projects/Now, mobile.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
