import assert from 'node:assert/strict'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {isDeepStrictEqual} from 'node:util'
import {chromium} from 'playwright-core'
import {preparePersonalQuiz} from '../src/personal-quiz.ts'
import {makeQuiz,newAttempt,answer} from '../src/quiz.ts'
const [previousFile,nextFile,reportFile]=process.argv.slice(2)
const old=JSON.parse(await readFile(previousFile,'utf8')),next=JSON.parse(await readFile(nextFile,'utf8'))
const bank=await preparePersonalQuiz(old.vocabulary),quiz=makeQuiz(bank.catalogs.A2,()=>0.4)
const attempt=answer(newAttempt(quiz,'random'),quiz[0].choices.find(c=>c.id!==quiz[0].correctId).id)
const {kind,level,reliability,requestedCount,index,answers,finished}=attempt
const raw=JSON.stringify({version:1,revision:bank.revision,kind,level,reliability,requestedCount,index,answers,finished,questions:quiz.map(q=>({id:q.id,options:q.choices.map(c=>c.id)}))})
const dist=new URL('../dist/',import.meta.url)
const names=[...(await readdir(dist)).filter(n=>n!=='assets'),...(await readdir(new URL('assets/',dist))).map(n=>'assets/'+n)]
const files=new Map(await Promise.all(names.map(async n=>[n,await readFile(new URL(n,dist))])))
const types={html:'text/html',js:'application/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',webmanifest:'application/manifest+json'}
const server=createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;const name=p==='/german-quiz/'?'index.html':p.slice(13);const b=files.get(name);if(req.method!=='GET'||!p.startsWith('/german-quiz/')||!b)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)]}).end(b)})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
let browser
try{
browser=await chromium.launch({channel:'chrome'})
const context=await browser.newContext(),page=await context.newPage(),url='http://127.0.0.1:'+server.address().port+'/german-quiz/'
const foreign=[];await context.route('**/*',r=>r.request().method()==='GET'&&r.request().url().startsWith(url)?r.continue():(foreign.push(r.request().method()),r.abort()))
const go=route=>page.evaluate(route=>location.hash='/'+route,route)
const read=key=>page.evaluate(key=>new Promise((resolve,reject)=>{const r=indexedDB.open('german-quiz-study',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('study','readonly'),q=tx.objectStore('study').get(key);tx.oncomplete=()=>{db.close();resolve(q.result)};tx.onabort=()=>reject(tx.error)};r.onerror=()=>reject(r.error)}),key)
const importDone='تم استيراد المحتوى التعليمي وحفظه على هذا الجهاز.'
await page.goto(url+'#/settings');await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
await page.locator('#education-file').setInputFiles(previousFile);await page.getByText(importDone,{exact:true}).waitFor()
await page.evaluate(raw=>localStorage.setItem('german-quiz:attempt',raw),raw)
const before=await read('education')
await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(this.name==='study'&&k==='legacy-quiz-sessions-v2'){IDBObjectStore.prototype.put=original;throw new DOMException('Test archive rollback','QuotaExceededError')}return original.call(this,v,k)}})
await page.locator('#education-file').setInputFiles(nextFile);await page.getByRole('alert').waitFor();console.log('Import rollback message: '+await page.getByRole('alert').innerText());assert((await page.getByRole('alert').innerText()).includes('مساحة التخزين'))
assert(isDeepStrictEqual(await read('education'),before));assert.equal(await page.evaluate(()=>localStorage.getItem('german-quiz:attempt')),raw)
await page.locator('#education-file').setInputFiles(nextFile);await page.getByText(importDone,{exact:true}).waitFor()
assert(isDeepStrictEqual((await read('education')).content,next))
const archive=await read('legacy-quiz-sessions-v2');assert.equal(archive.recoveries[0].raw,raw);assert(isDeepStrictEqual(archive.sessions[0].attempt,attempt))
await go('quiz');await page.locator('.question-panel').waitFor()
assert.equal(await page.locator('.question-header h1').innerText(),quiz[0].prompt.text)
assert.deepEqual(await page.locator('.choice-text').allTextContents(),quiz[0].choices.map(c=>c.text))
await page.getByText('إجابة غير صحيحة',{exact:true}).waitFor()
await page.getByRole('button',{name:'السؤال التالي',exact:true}).click()
for(let i=1;i<quiz.length;i++){
await page.getByText(quiz[i].prompt.text,{exact:true}).first().waitFor()
await page.locator('.choices button').nth(quiz[i].choices.findIndex(c=>c.id===quiz[i].correctId)).click()
await page.getByRole('button',{name:i===quiz.length-1?'عرض النتيجة':'السؤال التالي',exact:true}).click()
}
await page.getByRole('heading',{name:'نتيجة الاختبار',exact:true}).waitFor()
await page.waitForFunction(()=>new Promise(resolve=>{const r=indexedDB.open('german-quiz-study',1);r.onsuccess=()=>{const d=r.result,q=d.transaction('study').objectStore('study').get('legacy-quiz-sessions-v2');q.onsuccess=()=>{d.close();resolve(q.result?.sessions[0]?.attempt.finished)}}}))
assert.equal((await read('legacy-quiz-sessions-v2')).sessions[0].attempt.answers.filter((a,i)=>a!==quiz[i].correctId).length,1)
assert.equal(await page.evaluate(()=>localStorage.getItem('german-quiz:attempt')),raw)
await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'نتيجة الاختبار',exact:true}).waitFor()
await go('progress');await page.getByRole('button',{name:'افتح الجلسة المحفوظة',exact:true}).click();await page.getByRole('heading',{name:'نتيجة الاختبار',exact:true}).waitFor()
await page.getByRole('button',{name:'أعد الأسئلة الخاطئة',exact:true}).click();await page.locator('.question-panel').waitFor()
assert.equal(await page.locator('.question-header h1').innerText(),quiz[0].prompt.text)
assert.deepEqual(new Set(await page.locator('.choice-text').allTextContents()),new Set(quiz[0].choices.map(c=>c.text)))
assert.deepEqual(foreign,[])
const second=await browser.newContext(),missing=await second.newPage()
await missing.goto(url+'#/settings');await missing.locator('#education-file').setInputFiles(nextFile);await missing.getByText(importDone,{exact:true}).waitFor()
await missing.evaluate(raw=>{localStorage.setItem('german-quiz:attempt',raw);location.hash='/quiz'},raw);await missing.reload()
await missing.getByText(/لا تتوفر نسخة مطابقة لأسئلته ومفتاح تصحيحه/).waitFor()
assert.equal(await missing.evaluate(()=>localStorage.getItem('german-quiz:attempt')),raw)
const result={exactV1Recovery:true,atomicArchiveQuotaRollback:true,originalRawRecordUnchanged:true,originalQuestionTextAndChoiceOrder:true,originalGradingAndScore:true,historicalResultsAccessible:true,originalMistakeRetry:true,offlineRefresh:true,unreconstructableV1Explained:true,unknownGradingRejectedByUnitTests:true,networkUploads:foreign.length,realUserProfileUsed:false}
if(reportFile)await writeFile(reportFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{await browser?.close();server.close()}
