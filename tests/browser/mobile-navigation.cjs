// Disposable server: DATABASE_PATH=:memory: npm run dev -- --port 5197
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5197';
(async()=>{
 for(const [engine,name] of [[chromium,'chromium'],[webkit,'webkit']]){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/now');await page.waitForLoadState('networkidle');
   assert((await page.locator('meta[name=viewport]').getAttribute('content')).includes('viewport-fit=cover'));
   const bottom=page.getByRole('navigation',{name:'Primary navigation',exact:true});
   const toggle=page.getByLabel('Navigation',{exact:true});
   for(const [width,height] of [[375,812],[320,568],[390,844],[812,375]]){
    await page.setViewportSize({width,height});
    assert.deepEqual(await bottom.getByRole('link').allTextContents(),['Now','Backlog','Chores','Projects','Calendar']);
    const metrics=await bottom.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth,box:el.getBoundingClientRect().toJSON(),links:[...el.querySelectorAll('a')].map(a=>a.getBoundingClientRect().toJSON())}));
    assert(metrics.content<=metrics.width,`${name}: tabs overflow at ${width}`);
    for(const box of metrics.links){assert(box.width>=44&&box.height>=44);assert(box.x>=0&&box.right<=width&&box.bottom<=height);}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await toggle.click();
    const menu=page.getByRole('navigation',{name:'All pages'});await menu.waitFor();
    await menu.getByRole('link',{name:'Settings',exact:true}).scrollIntoViewIfNeeded();
    assert(await menu.getByRole('link',{name:'Settings',exact:true}).isVisible());
    await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
    assert(await toggle.evaluate(el=>el===document.activeElement));
   }
   await page.setViewportSize({width:375,height:812});
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:`/tmp/anii-mobile-nav-${name}.png`});
   await toggle.click();await page.screenshot({path:`/tmp/anii-mobile-menu-${name}.png`});
   const menu=page.getByRole('navigation',{name:'All pages'});
   await menu.getByRole('link',{name:'Completed',exact:true}).click();await page.waitForURL('**/completed');await menu.waitFor({state:'hidden'});
   assert.equal(await page.locator('.mobile-topbar strong').textContent(),'Completed');
   await toggle.click();await menu.getByRole('link',{name:'Settings',exact:true}).click();await page.waitForURL('**/settings');await menu.waitFor({state:'hidden'});
   await bottom.getByRole('link',{name:'Backlog',exact:true}).click();await page.waitForURL('**/backlog');
   assert.equal(await bottom.locator('[aria-current=page]').textContent(),'Backlog');
   await toggle.click();await page.mouse.click(10, 600);await menu.waitFor({state:'hidden'});
   await page.getByRole('button',{name:'Open capture chat',exact:true}).filter({visible:true}).click();
   await page.getByRole('dialog',{name:'Capture chat'}).waitFor();
   assert.equal(await page.locator('.mobile-topbar').getAttribute('inert'),'');
   await page.getByRole('button',{name:'Close chat',exact:true}).click();
   await page.getByRole('button',{name:'Open capture chat',exact:true}).filter({visible:true}).waitFor();
   await page.emulateMedia({colorScheme:'dark'});await toggle.click();await page.screenshot({path:`/tmp/anii-mobile-menu-dark-${name}.png`});await page.keyboard.press('Escape');
   await page.setViewportSize({width:1440,height:1000});assert.equal(await bottom.isVisible(),false);assert.equal(await page.locator('.rail').isVisible(),true);
   assert.deepEqual(errors,[]);console.log(`${name}: five tabs fit; all pages reachable; dismissal, capture, dark mode, and desktop pass.`);
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
