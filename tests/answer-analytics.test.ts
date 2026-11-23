import {readFileSync} from 'node:fs'
import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import {describe,expect,it} from 'vitest'
import {accuracyChange,analyzeAnswers,analyticsQuestionIndex} from '../src/answer-analytics'
import {AnswerCard,ArabicExplanation} from '../src/SimpleLearning'
import {buildLearningLibrary,validateQuestionFeedback} from '../src/learning-library'
import {maximumEducationBytes,readEducationFile,validateEducationPackage} from '../src/education-package'
import {preparePersonalQuiz} from '../src/personal-quiz'
import {day,mergeStudyProgress,type StudyEvent} from '../src/study-progress'
import {answer,makeQuiz,newAttempt} from '../src/quiz'
import {freezeSession} from '../src/legacy-session'
import type {TestSummary} from '../src/focus-session'
import {fixtureDataset} from './fixtures'

const start=Date.UTC(2024,0,1)
const event=(n:number,result:StudyEvent['result'],questionId='one',chapter='A1:1',extra:Partial<StudyEvent>={}):StudyEvent=>({
  id:'event:'+n,questionId,chapter,topic:'',time:start+n*day,type:'grammar',result,...extra,
})
const chapters=[{id:'A1:1',level:'A1',number:1},{id:'A2:4',level:'A2',number:4}] as const
const emptyIndex=analyticsQuestionIndex(buildLearningLibrary(null,null,true))

it('counts dated attempts and distinct questions independently across all stored results, without mutating input',()=>{
  const incorrect=event(1,'incorrect')
  const events=[incorrect,incorrect,event(2,'correct'),event(3,'incorrect','two','A2:4',{skill:'article'}),
    event(4,'known','card','A2:4',{type:'flashcard'}),event(5,'correct','one')]
  const history:TestSummary[]=Array.from({length:7},(_,i)=>({id:'focus:'+i,kind:'normal',time:start,total:10,correct:7,wrong:3,planned:10,stoppedEarly:false}))
  history.push({...history[0]},{...history[0],id:'focus:early',stoppedEarly:true})
  const before=structuredClone({events,history})
  const result=analyzeAnswers(events,history,[],chapters,emptyIndex,start+900*day)
  expect(result).toMatchObject({attempts:4,distinct:2,correct:2,wrong:2,completed:7,stoppedEarly:1,mastered:1,active:1,accuracy:.5})
  expect(result.chapters[0]).toMatchObject({attempts:3,distinct:1,correct:2,wrong:1,active:0})
  expect(result.chapters[1]).toMatchObject({attempts:1,distinct:1,correct:0,wrong:1,active:1})
  expect(result.skills.find(s=>s.id==='article')).toMatchObject({wrong:1,active:1})
  expect(result.chart.length).toBeLessThanOrEqual(24)
  expect(result.chart[0].start).toBe(start+day)
  expect(result.chart.at(-1)?.end).toBe(start+900*day)
  expect(result.chart.reduce((n,bin)=>n+bin.correct+bin.wrong,0)).toBe(4)
  expect({events,history}).toEqual(before)
})

it('preserves repeated mistakes, streak resets, and honest empty states',()=>{
  const rows=[event(1,'incorrect'),event(2,'correct'),event(3,'incorrect'),event(4,'correct'),
    event(5,'missed','card','A2:4',{type:'flashcard'}),event(6,'missed')]
  const result=analyzeAnswers(rows,[],[],chapters,emptyIndex)
  expect(result).toMatchObject({nearMastery:1,repeated:1,active:1,mastered:0,change:null})
  expect(result.mistakes[0]).toMatchObject({misses:2,streak:1})
  expect(result.chapters[1]).toMatchObject({attempts:0,accuracy:null,change:null})
  expect(analyzeAnswers([],[],[],chapters,emptyIndex)).toMatchObject({attempts:0,completed:0,accuracy:null,chart:[]})
})

it('shows a trend only when both periods contain different days and distinct questions',()=>{
  const rows=Array.from({length:12},(_,i)=>({id:'e'+i,questionId:'q'+i,correct:i>=6,skill:'article',time:start+i*day}))
  expect(accuracyChange(rows)).toBe(1)
  expect(accuracyChange(rows.slice(0,10))).toBeNull()
  expect(accuracyChange(rows.map(row=>({...row,time:start})))).toBeNull()
  expect(accuracyChange(rows.map(row=>({...row,questionId:'same'})))).toBeNull()
})

it('recovers actual legacy grades once, without inventing a date or a chapter',async()=>{
  const bank=await preparePersonalQuiz(fixtureDataset),items=makeQuiz(bank.catalogs.A1,()=>.5,10)
  const old=answer(newAttempt(items,'random','A1'),items[0].choices.find(c=>c.id!==items[0].correctId)!.id)
  const frozen=freezeSession(old,bank.revision,'old')
  expect(analyzeAnswers([],[],[frozen,frozen],chapters,emptyIndex,start)).toMatchObject({
    attempts:1,distinct:1,wrong:1,active:1,undated:1,unassigned:1,chart:[],
  })
  const dated=freezeSession(old,bank.revision,'old',[start])
  expect(analyzeAnswers([],[],[frozen,dated],chapters,emptyIndex,start)).toMatchObject({
    attempts:1,undated:0,chart:[{start,wrong:1,correct:0}],
  })
})

it('merges more than 30,000 historical events without discarding one',()=>{
  const events=Array.from({length:30001},(_,i)=>event(i,'correct','one','A1:1',{time:start+i}))
  expect(mergeStudyProgress(events,[events[0]])).toHaveLength(30001)
})

it('renders multiline Arabic feedback and isolates German, with safe empty-explanation rendering',()=>{
  const markup=renderToStaticMarkup(createElement(ArabicExplanation,{text:'تتغير الأداة مع الحالة الإعرابية. «der» للمذكّر.\n\nاقرأ «der Test».'.repeat(30)}))
  expect(markup).toContain('lang="ar" dir="rtl"')
  expect(markup).toContain('lang="de" dir="ltr"')
  expect((markup.match(/<p>/g)??[]).length).toBeGreaterThan(1)
  const fallback=renderToStaticMarkup(createElement(AnswerCard,{q:{id:'a',chapter:'A2:4',type:'grammar',
    instruction:'',prompt:'Test',answers:['Antwort'],explanation:''}}))
  expect(fallback).toContain('Antwort')
  expect(fallback).toContain('A2')
  expect(fallback).not.toContain('answer-explanation')
})

const canonical=process.env.GERMAN_QUIZ_CANONICAL_FILE
const original=process.env.GERMAN_QUIZ_FINAL_UI_BASE
describe.runIf(Boolean(canonical&&original))('single private canonical package',()=>{
  it('imports the complete package independently, retains all content IDs, and binds explanations to real admitted answers',async()=>{
    const file=readFileSync(canonical!)
    expect(canonical).toMatch(/german-quiz-final-complete\.json$/)
    expect(file.length).toBeLessThan(maximumEducationBytes)
    const data=validateEducationPackage(await readEducationFile(new File([file],'german-quiz-final-complete.json')))
    const old=JSON.parse(readFileSync(original!,'utf8'))
    expect(data.vocabulary).toEqual(old.vocabulary)
    expect(data.study).toEqual(old.study)
    expect(data.explanations).toBeUndefined()
    const bank=await preparePersonalQuiz(data.vocabulary)
    expect(()=>validateQuestionFeedback(data.feedback!,bank,data.study)).not.toThrow()
    expect(()=>validateQuestionFeedback([{...data.feedback![0],answer:'different key'}],bank,data.study)).toThrow()
    const library=buildLearningLibrary(bank,data.study,true,undefined,data.feedback)
    expect(library.chapters).toHaveLength(24)
    expect(library.multipleChoice.every(i=>i.view.explanation.length>0)).toBe(true)
    expect(library.multipleChoice.find(i=>i.view.skill==='article'&&i.view.optionFeedback)?.view.explanation).toMatch(/الحالة الإعرابية/)
    expect(library.byId.size).toBe(library.items.length)
  },30000)
})
