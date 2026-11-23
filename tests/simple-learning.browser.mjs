import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {isDeepStrictEqual} from 'node:util'
import {chromium} from 'playwright-core'
import {preparePersonalQuiz} from '../src/personal-quiz.ts'
import {buildLearningLibrary} from '../src/learning-library.ts'
import {newFocusSession} from '../src/focus-session.ts'
import {checkStudyAnswer} from '../src/study-engine.ts'

const [originalFile,enrichedFile,folder]=process.argv.slice(2)
await mkdir(folder,{recursive:true})
const original=JSON.parse(await readFile(originalFile,'utf8')),enriched=JSON.parse(await readFile(enrichedFile,'utf8'))
const bank=await preparePersonalQuiz(enriched.vocabulary),library=buildLearningLibrary(bank,enriched.study,true,enriched.explanations,enriched.feedback)
const dist=new URL('../dist/',import.meta.url),names=[...(await readdir(dist)).filter(n=>n!=='assets'),...(await readdir(new URL('assets/',dist))).map(n=>'assets/'+n)]
const files=new Map(await Promise.all(names.map(async n=>[n,await readFile(new URL(n,dist))])))
const types={html:'text/html',js:'application/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json'}
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname,name=path.replace(/^\/german-quiz\//,'')||'index.html',data=files.get(name);if(req.method!=='GET'||!path.startsWith('/german-quiz/')||!data)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)]}).end(data)})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const url='http://127.0.0.1:'+server.address().port+'/german-quiz/',profile=join(tmpdir(),'gq-ui-'+Date.now())
let ctx,page
const results=[],failures=[],foreign=[],errors=[],roundLaunches=[]
async function check(name,work){try{await work();results.push(name);console.log('PASS '+name)}catch(e){failures.push({name,message:String(e)});throw e}}
async function open(){ctx=await chromium.launchPersistentContext(profile,{channel:'chrome',viewport:{width:1200,height:900},acceptDownloads:true});page=ctx.pages()[0];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>{if(!r.url().startsWith(url))foreign.push({method:r.method(),origin:new URL(r.url()).origin})})}
const button=name=>page.getByRole('button',{name,exact:true})
const go=async route=>{await page.evaluate(route=>location.hash='/'+route,route);await page.locator('main[data-screen="'+(route||'home')+'"]').waitFor();await page.waitForFunction(()=>!document.querySelector('.simple-loading'))}
const progress=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('german-quiz-study',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('study','readonly'),store=tx.objectStore('study'),old=store.get('progress'),log=store.getAll(IDBKeyRange.bound('answer-event:','answer-event:\uffff'));tx.oncomplete=()=>{db.close();resolve([...(old.result??[]),...log.result])};tx.onabort=()=>reject(tx.error)};req.onerror=()=>reject(req.error)}))
const record=key=>page.evaluate(key=>new Promise((resolve,reject)=>{const open=indexedDB.open('german-quiz-study',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('study','readonly'),r=tx.objectStore('study').get(key);tx.oncomplete=()=>{db.close();resolve(r.result??null)};tx.onabort=()=>reject(tx.error)};open.onerror=()=>reject(open.error)}),key)
const put=entries=>page.evaluate(entries=>new Promise((resolve,reject)=>{const open=indexedDB.open('german-quiz-study',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('study','readwrite');for(const[k,v]of entries)tx.objectStore('study').put(v,k);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)};open.onerror=()=>reject(open.error)}),entries)
const importSheet=async()=>{if(!await page.locator('.content-dialog').isVisible())await button('استيراد المحتوى التعليمي').click();await page.locator('#education-file').waitFor({state:'attached'});await page.waitForFunction(()=>!document.querySelector('#education-file').disabled)}
const closeSheet=async()=>button('إغلاق').click()
const ready=async()=>{await page.waitForFunction(()=>document.querySelectorAll('.home-action').length===4&&!document.querySelector('.simple-loading'))}
const importDone='تم استيراد المحتوى التعليمي وحفظه على هذا الجهاز.'
const now=Date.now()-10000
const seeded=library.multipleChoice.find(i=>i.origin!=='vocabulary').make()
const seed={id:'ui-seed:wrong',questionId:seeded.id,chapter:seeded.chapter,topic:seeded.topic,type:seeded.type,time:now,result:'incorrect',evidenceVersion:2}
const counts={vocabulary:original.vocabulary.entries.length,chapters:original.study.chapters.length,storedActivities:original.study.questions.length}
async function choose(correct=true){const s=await record('focus-test-current-v1'),q=s.items[s.queue[s.cursor]],choice=q.choices.find(c=>checkStudyAnswer(q,c)===correct),at=q.choices.indexOf(choice);assert(at>=0);await page.locator('.focus-choice').nth(at).click();await page.locator('.focus-feedback').waitFor();return {s,q,choice}}
async function next(){const before=await record('focus-test-current-v1');await button('السؤال التالي').click();if(before.cursor+1===before.queue.length)await page.locator('.simple-results').waitFor();else await page.waitForFunction(()=>!document.querySelector('.focus-feedback'))}
try{
 await open();await page.goto(url);await ready()
 await check('Four accessible primary cards, green palette, missing-content state',async()=>{assert.equal(await page.locator('.home-actions>a').count(),4);assert.deepEqual(await page.locator('.home-action h2').allTextContents(),['الاختبار','مراجعة الأخطاء','جميع الأسئلة','تحليل أدائي']);assert.equal((await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--green'))).trim(),'#176345');await page.locator('.home-action').first().focus();assert(await page.locator('.home-action').first().evaluate(e=>e===document.activeElement));await page.keyboard.press('Enter');await page.locator('.test-setup').waitFor();assert(await button('بدء الاختبار').isDisabled());await go('')})
 await check('Complete original 20.4 MB JSON imports unchanged',async()=>{await importSheet();await page.locator('#education-file').setInputFiles(originalFile);await page.getByText(importDone,{exact:true}).waitFor();assert(isDeepStrictEqual((await record('education')).content,original));await closeSheet();await ready()})
 await put([['progress',[seed]],['ui-preservation-sentinel',{value:'keep-existing-record'}]])
 await page.evaluate(()=>{localStorage.setItem('german-quiz:quiz-settings',JSON.stringify({level:'A1',count:20,reliability:'reviewed'}));localStorage.setItem('german-quiz:user-sentinel','keep')})
 await check('Invalid JSON and aborted replacement leave content and progress unchanged',async()=>{await importSheet();await page.locator('#education-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.locator('.education-import [role=alert]').waitFor();assert(isDeepStrictEqual((await record('education')).content,original));await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='education'){IDBObjectStore.prototype.put=put;this.transaction.abort();throw new DOMException('Isolated interruption','AbortError')}return put.call(this,value,key)}});await page.locator('#education-file').setInputFiles(enrichedFile);await page.locator('.education-import [role=alert]').waitFor();assert(isDeepStrictEqual((await record('education')).content,original));assert.deepEqual(await progress(),[seed]);await closeSheet()})
 await check('Private explanation enrichment import, idempotence, exact export and preserved older keys',async()=>{await importSheet();await page.locator('#education-file').setInputFiles(enrichedFile);await page.getByText(importDone,{exact:true}).waitFor();assert(isDeepStrictEqual((await record('education')).content,enriched));await page.locator('#education-file').setInputFiles(enrichedFile);await page.getByText('ملف المحتوى محفوظ بالفعل.',{exact:true}).waitFor();assert.deepEqual(await progress(),[seed]);assert.equal((await record('ui-preservation-sentinel')).value,'keep-existing-record');await page.getByText('النسخ الاحتياطي والاستعادة',{exact:true}).click();const [download]=await Promise.all([page.waitForEvent('download'),button('تنزيل ملف المحتوى').click()]);assert(isDeepStrictEqual(JSON.parse(await readFile(await download.path(),'utf8')),enriched));assert.equal(await page.locator('.data-reliability').count(),0);await closeSheet();await page.reload();await ready();assert.equal(await page.evaluate(()=>localStorage.getItem('german-quiz:user-sentinel')),'keep')})
 await check('Read-only question browser, 20-card paging, both levels, unmount on close, no progress writes',async()=>{const before=await progress();await go('questions');assert.equal(await page.locator('.question-chapters>details').count(),12);const chapter=page.locator('.question-chapters>details').first();await chapter.locator('summary').click();await page.waitForFunction(()=>document.querySelectorAll('.answer-card').length===20);assert.equal(await page.locator('.focus-choice').count(),0);await chapter.getByRole('button',{name:'تحميل المزيد',exact:true}).click();assert.equal(await chapter.locator('.answer-card').count(),40);await chapter.locator('summary').click();await page.waitForFunction(()=>document.querySelectorAll('.answer-card').length===0);await page.getByRole('button',{name:'A2',exact:true}).click();assert.equal(await page.locator('.question-chapters>details').count(),12);await page.locator('.question-chapters summary').first().click();await page.waitForFunction(()=>document.querySelectorAll('.answer-card').length===20);assert.equal(await page.locator('.answer-card').count(),20);assert.deepEqual(await progress(),before);assert.equal(await page.locator('input[type=search]').count(),0)})
 await check('All 24 chapters, additive group controls, mixed selection and persisted count',async()=>{
  await go('analytics');assert(await page.getByText(/لم تُكمل أي اختبار/).isVisible());
  await go('setup');const selector=page.locator('.chapter-select'),boxes=selector.locator('input[type=checkbox]');
  await selector.locator('summary').click();assert.equal(await boxes.count(),24);
  await button('إلغاء التحديد').click();assert(await button('بدء الاختبار').isDisabled());
  await boxes.nth(13).check();await button('تحديد كل A1').click();assert.equal(await selector.locator(':checked').count(),13);
  await button('إلغاء التحديد').click();await boxes.nth(2).check();await button('تحديد كل A2').click();assert.equal(await selector.locator(':checked').count(),13);
  await button('تحديد الكل').click();assert.equal(await selector.locator(':checked').count(),24);
  await button('إلغاء التحديد').click();for(const i of [1,6,15,21])await boxes.nth(i).check();
  await selector.locator('summary').click();assert.match(await selector.locator('summary').innerText(),/٤ من ٢٤/);
  await page.getByRole('radio',{name:'٥٠',exact:true}).check();await page.reload();await page.locator('.test-setup').waitFor();
  assert(await page.getByRole('radio',{name:'٥٠',exact:true}).isChecked());assert.match(await selector.locator('summary').innerText(),/٤ من ٢٤/);
  await selector.locator('summary').click();assert.equal(await selector.locator(':checked').count(),4)
 })
 await check('Mixed real rounds realize every count preset without duplicates',async()=>{
  const pool=library.multipleChoice.filter(i=>['A1:2','A1:7','A2:4','A2:10'].includes(i.chapter)),available=new Set(pool.map(i=>i.key)).size;
  for(const [count,label]of [[10,'١٠'],[20,'٢٠'],[30,'٣٠'],[50,'٥٠'],['all','الكل']]){
   await go('setup');await page.getByRole('radio',{name:label,exact:true}).check();
   const time=Date.now();await button('بدء الاختبار').click();await page.locator('.focus-choices').waitFor();
   const round=await record('focus-test-current-v1');assert.equal(round.items.length,count==='all'?available:Math.min(count,available));
   assert.equal(new Set(round.items.map(q=>library.byId.get(q.id).key)).size,round.items.length);
   assert(round.items.every(q=>['A1:2','A1:7','A2:4','A2:10'].includes(q.chapter)));
   for(const q of round.items)assert.equal(q.choices.filter(c=>checkStudyAnswer(q,c)).length,1);
   if(count==='all')assert.equal(new Set(round.items.map(q=>q.chapter)).size,4)
   roundLaunches.push({requested:count,actual:round.items.length,milliseconds:Date.now()-time,types:[...new Set(round.items.map(q=>q.type))]})
  }
  await go('setup');await page.getByRole('radio',{name:'١٠',exact:true}).check();await button('بدء الاختبار').click();await page.locator('.focus-choices').waitFor()
 })
 const originalRound=await record('focus-test-current-v1')
 await check('Immediate locked feedback, examples hidden before answer, manual Next and exact reload recovery',async()=>{assert.equal(await page.locator('.focus-feedback,.session-examples').count(),0);const chosen=await choose(false),saved=await record('focus-test-current-v1');assert.equal(saved.cursor,0);assert.equal(saved.answers.length,1);assert.equal(await page.locator('.focus-choice.correct').count(),1);assert.equal(await page.locator('.focus-choice.wrong').count(),1);assert(await page.locator('.selected-answer').isVisible());assert.equal(await page.locator('.focus-question .question-chapter-label').count(),1);assert.equal(await page.locator('.focus-choice.correct').getAttribute('aria-disabled'),'true');await page.locator('.focus-choice.correct').evaluate(e=>e.click());assert(isDeepStrictEqual(await record('focus-test-current-v1'),saved));await page.reload();await page.locator('.focus-feedback').waitFor();assert(isDeepStrictEqual(await record('focus-test-current-v1'),saved));assert.equal(await page.locator('.focus-question h2').innerText(),chosen.q.prompt);await next();await page.waitForFunction(()=>!document.querySelector('.focus-feedback'));assert.equal((await record('focus-test-current-v1')).cursor,1);await go('');await button('متابعة الاختبار').click();await page.locator('.focus-choices').waitFor();assert.deepEqual((await record('focus-test-current-v1')).items,originalRound.items)})
 await check('Real normal-test completion and test-specific retry retains original fact and options',async()=>{for(let i=1;i<10;i++){await choose(true);await next()}await page.locator('.simple-results').waitFor();await button('مراجعة الأخطاء').click();await page.locator('.answer-card').waitFor();assert.equal(await page.locator('.answer-card').count(),1);await button('إعادة اختبار الأخطاء').click();await page.locator('.focus-choices').waitFor();const retry=await record('focus-test-current-v1');assert.equal(retry.kind,'retry');assert.equal(retry.items.length,1);assert.deepEqual(retry.items[0].answers,originalRound.items[0].answers);assert.deepEqual(new Set(retry.items[0].choices),new Set(originalRound.items[0].choices));await choose(true);await next();await page.locator('.simple-results').waitFor()})
 await check('Archived unfinished sessions are retained without replacing a newer current answer',async()=>{await go('setup');await button('بدء الاختبار').click();await page.locator('.focus-choices').waitFor();const unfinished=await record('focus-test-current-v1');await choose(true);const saved=await record('focus-test-current-v1');await go('setup');await button('بدء الاختبار').click();await page.locator('.focus-choices').waitFor();assert.notEqual((await record('focus-test-current-v1')).id,unfinished.id);assert(isDeepStrictEqual(await record('focus-test:'+unfinished.id),saved));assert((await record('focus-test-archive-v1')).some(a=>a.id===unfinished.id&&!a.finished));await go('');await importSheet();await page.locator('.session-archive summary').click();await button('استئناف الاختبار المؤرشف').last().click();await page.locator('.focus-feedback').waitFor();assert(isDeepStrictEqual(await record('focus-test-current-v1'),saved))})
 await check('Grouped-pronoun verb questions preserve exact IDs and save actual answers',async()=>{const item=library.multipleChoice.find(i=>i.id.includes(':verb-present:er/sie/es:'));assert(item);const question=item.make();await put([['focus-test-current-v1',newFocusSession([question],'normal','focus:pronoun-check')]]);await page.reload();await go('test');await page.locator('.focus-choices').waitFor();await choose(true);await next();assert((await progress()).some(e=>e.questionId===question.id&&e.result==='correct'));await page.reload();await page.locator('.simple-results').waitFor();assert((await progress()).some(e=>e.questionId===question.id))})
 await check('Approved bilingual examples appear only after answering, in German LTR and Arabic RTL',async()=>{let exampleQuestion;for(const candidate of library.multipleChoice.filter(i=>i.origin==='vocabulary')){const q=candidate.make();if(q.examples?.[0]?.arabic){exampleQuestion=q;break}}assert(exampleQuestion);await put([['focus-test-current-v1',newFocusSession([exampleQuestion],'normal','focus:example-check')]]);await page.reload();await go('test');await page.locator('.focus-choices').waitFor();assert.equal(await page.locator('.session-examples').count(),0);await choose(true);await page.locator('.session-examples').waitFor();assert.equal(await page.locator('.session-examples [lang=de]').getAttribute('dir'),'ltr');assert.equal(await page.locator('.session-examples [lang=ar]').getAttribute('dir'),'rtl');assert(exampleQuestion.examples.some(e=>e.german));const displayedGerman=await page.locator('.session-examples [lang=de]').innerText(),displayedArabic=await page.locator('.session-examples [lang=ar]').innerText();assert(exampleQuestion.examples.some(e=>e.german===displayedGerman&&e.arabic===displayedArabic));await next();const noExample=library.multipleChoice.find(i=>i.origin!=='vocabulary'&&i.id!==seed.questionId&&i.view.prompt!==seeded.prompt&&!i.view.examples?.length).make();await put([['focus-test-current-v1',newFocusSession([noExample],'normal','focus:no-example-check')]]);await page.reload();await go('test');await choose(true);assert.equal(await page.locator('.session-examples').count(),0);await next()})
 await check('Mistake study is read-only; actual attempts require two consecutive correct answers across reloads',async()=>{
  await go('mistakes');const before=await progress();await page.locator('.answer-card').first().waitFor();assert(await page.locator('.answer-correct').first().isVisible());assert.deepEqual(await progress(),before)
  // Isolate one real admitted fact without erasing earlier test history.
  const item=library.byId.get(seed.questionId),current=newFocusSession([item.make()],'mistakes','focus:mastery-first')
  await put([['focus-test-current-v1',current]]);await page.reload();await go('test');await choose(true);await next();await go('mistakes');assert(await page.getByText(seed.prompt??seeded.prompt,{exact:true}).first().isVisible())
  await put([['focus-test-current-v1',newFocusSession([item.make()],'mistakes','focus:mastery-second')]]);await page.reload();await go('test');await choose(true);await next();await go('mistakes');await page.reload();await page.waitForFunction(()=>!document.querySelector('.simple-loading'));assert.equal(await page.getByText(seeded.prompt,{exact:true}).count(),0)
  await put([['focus-test-current-v1',newFocusSession([item.make()],'normal','focus:mastery-reopen')]]);await page.reload();await go('test');await choose(false);await next();await go('mistakes');assert(await page.getByText(seeded.prompt,{exact:true}).first().isVisible())
 })
 await check('Mistake test covers all eligible active errors, wrong answer requeues, finish-early persists unresolved errors',async()=>{await button('اختبار الأخطاء').click();await button('بدء اختبار الأخطاء').click();await page.locator('.focus-choices').waitFor();const before=await record('focus-test-current-v1');await choose(false);const after=await record('focus-test-current-v1');assert.equal(after.queue.length,before.queue.length+1);assert.equal(after.queue.at(-1),before.queue[0]);await button('إنهاء المراجعة الآن وحفظ الأخطاء المتبقية').click();await page.locator('.simple-results').waitFor();assert((await record('focus-test-current-v1')).stoppedEarly);const history=await record('focus-test-history-v1');assert(history.length>3);await page.locator('.recent-tests summary').click();assert.equal(await page.locator('.recent-tests li').count(),3);assert.equal((await record('focus-test-history-v1')).length,history.length)})
 await check('Canonical option feedback and independent durable attempt log',async()=>{
  const row=library.multipleChoice.find(i=>i.view.skill==='article'&&i.view.optionFeedback);
  assert(row);const q=row.make();const session=newFocusSession([q],'normal','focus:option-feedback')
  await put([['focus-test-current-v1',session]]);await page.reload();await go('test');
  const previous=await progress();await choose(false);assert(await page.locator('.option-feedback').isVisible());
  assert(await page.locator('.focus-feedback .answer-explanation [lang=de][dir=ltr]').count()>0);
  assert(await page.locator('.focus-feedback .answer-explanation[dir=rtl]').count()>0);
  assert.equal((await progress()).length,previous.length+1);await page.reload();await page.locator('.focus-feedback').waitFor();
  assert.equal((await progress()).length,previous.length+1);await next()
 })
 await check('Chapter assessment saves one graded answer and one completed summary',async()=>{
  const item=library.multipleChoice.find(i=>i.view.type==='grammar'&&i.view.choices).make()
  const assessment={id:'test-assessment',items:[item],assessment:true};
  const before=await progress();
  await put([['practice-plan-v2',assessment],['practice-position-v2',{id:assessment.id,index:0,results:[],response:''}]]);
  await page.evaluate(()=>location.hash='/practice');await page.locator('.session-choice').first().waitFor();
  const choice=item.choices.find(value=>checkStudyAnswer(item,value));
  await page.locator('.session-choice').getByText(choice,{exact:true}).click();await button('النشاط التالي').click();
  await page.locator('.session-results').waitFor();
  await page.waitForFunction(()=>new Promise(resolve=>{const r=indexedDB.open('german-quiz-study',1);r.onsuccess=()=>{const d=r.result,tx=d.transaction('study'),q=tx.objectStore('study').get('focus-test-history-v1');q.onsuccess=()=>{d.close();resolve(q.result?.some(s=>s.kind==='assessment'&&s.id==='test-assessment'))}}}));
  assert.equal((await progress()).length,before.length+1);
  assert.equal((await record('focus-test-history-v1')).filter(r=>r.id===assessment.id&&r.correct===1).length,1);
  await page.reload();await page.locator('.session-results').waitFor();assert.equal((await progress()).length,before.length+1)
 })
 await check('Full analytics shows real totals, 24 chapters and no read-side writes',async()=>{
  const before=await progress(), history=await record('focus-test-history-v1'), current=await record('focus-test-current-v1');
  const graded=before.filter(e=>e.result==='correct'||e.result==='incorrect');
  await go('analytics');const cells=await page.locator('.answer-metrics dd').allTextContents();
  const format=new Intl.NumberFormat('ar');
  assert.equal(cells[0],format.format(history.filter(r=>!r.stoppedEarly&&r.total).length));assert.equal(cells[1],format.format(graded.length));
  assert.equal(cells[2],format.format(new Set(graded.map(e=>e.questionId)).size));
  assert.equal(cells[3],format.format(graded.filter(e=>e.result==='correct').length));assert.equal(cells[4],format.format(graded.filter(e=>e.result==='incorrect').length));
  assert.equal(await page.locator('.analytics-rows').first().locator('article').count(),24)
  await page.locator('.analytics-chart button').first().click();await page.reload();await page.locator('.answer-metrics').waitFor();
  assert.deepEqual(await page.locator('.answer-metrics dd').allTextContents(),cells);
  assert.deepEqual(await progress(),before);assert.deepEqual(await record('focus-test-history-v1'),history);assert.deepEqual(await record('focus-test-current-v1'),current)
 })
 await check('German LTR, Arabic RTL, keyboard navigation, mobile and desktop screenshots, dark theme',async()=>{await go('');await page.setViewportSize({width:1200,height:900});await page.screenshot({path:join(folder,'after-1200.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(folder,'after-390.png'),fullPage:true});for(const route of ['','setup','mistakes','questions','analytics']){await go(route);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(route==='questions'){await page.locator('.question-chapters summary').first().click();for(const e of await page.locator('[lang=de]').all())assert.equal(await e.getAttribute('dir'),'ltr');for(const e of await page.locator('[lang=ar]').all())assert.equal(await e.getAttribute('dir'),'rtl')}}await go('analytics');await page.screenshot({path:join(folder,'analytics-390.png')});await go('setup');await page.screenshot({path:join(folder,'setup-390.png'),fullPage:true});await go('');await button('تفعيل الوضع الداكن').click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');await page.screenshot({path:join(folder,'after-dark-390.png'),fullPage:true})})
 await check('Browser restart offline retains imported content, progress, theme and review state',async()=>{await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));const before=await progress();await ctx.close();await open();await ctx.setOffline(true);await page.goto(url);await ready();assert.deepEqual(await progress(),before);assert(isDeepStrictEqual((await record('education')).content,enriched));assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');await go('analytics');await page.locator('.answer-metrics').waitFor();await go('mistakes');await page.locator('.answer-card').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))})
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(foreign.length,0,JSON.stringify(foreign))
}catch(error){await page.screenshot({path:join(folder,'failure.png'),fullPage:true}).catch(()=>{});console.error({error:String(error),dialogOpen:await page.locator('.content-dialog').isVisible(),alerts:await page.locator('[role=alert]').allTextContents(),statuses:await page.locator('[role=status]').allTextContents()});throw error}finally{
 await writeFile(join(folder,'browser-results.json'),JSON.stringify({passed:results.length,checks:results,failures,counts,originalBytes:(await readFile(originalFile)).length,enrichedBytes:(await readFile(enrichedFile)).length,foreignRequests:foreign,uncaughtErrors:errors,isolatedProfile:profile,realPhoneTest:false,roundLaunches},null,2)+'\n')
 await ctx?.close();server.close()
}
