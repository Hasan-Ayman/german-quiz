import {describe,it,expect} from 'vitest'
import {entries,distractorGroups,fixtureDataset} from './fixtures'
import {buildCatalog,makeQuiz,newAttempt,answer,nextQuestion,incorrectAnswers} from '../src/quiz'
import {preparePersonalQuiz} from '../src/personal-quiz'
import {saveAttempt} from '../src/storage'
import {freezeSession,validateFrozenSession,originalLegacySession,addLegacyRecovery,readLegacySessions} from '../src/legacy-session'
const catalog=buildCatalog(entries,'A2',false,distractorGroups)
const round=makeQuiz(catalog,()=>0.4)
const attempt=answer(newAttempt(round,'random'),round[0].choices.find(c=>c.id!==round[0].correctId)!.id)
describe('immutable legacy quiz recovery',()=>{
it('freezes the exact original question text, option order, answer key and selected answer',()=>{
const saved=freezeSession(attempt,'original-bank','session-1')
const restored=validateFrozenSession(JSON.parse(JSON.stringify(saved)))
expect(restored.attempt).toEqual(attempt)
expect(restored.grading).toBe('choice-id-v1')
expect(incorrectAnswers(restored.attempt)).toEqual(incorrectAnswers(attempt))
})
it('preserves completed historical scores without consulting a replacement bank',()=>{
let done=newAttempt(round,'random')
for(const q of round)done=nextQuestion(answer(done,q.correctId))
const stored=freezeSession(done,'removed-bank','finished-1')
expect(validateFrozenSession(stored).attempt.finished).toBe(true)
expect(incorrectAnswers(stored.attempt)).toHaveLength(0)
const altered=structuredClone(round);altered[0].correctId='other-key';altered[0].prompt.text='Changed outside saved state'
expect(stored.attempt.questions[0]).toEqual(round[0])
})
it('rejects unknown grading rules and malformed or ambiguous frozen questions',()=>{
for(const mutate of [
(s:any)=>s.grading='future-rule',
(s:any)=>s.attempt.questions[0].choices.pop(),
(s:any)=>s.attempt.questions[0].correctId='missing-correct',
(s:any)=>s.attempt.questions[0].choices[1]=s.attempt.questions[0].choices[0],
(s:any)=>s.attempt.answers[0]='missing-answer',
(s:any)=>s.attempt.questions.push(s.attempt.questions[0]),
]){const s=freezeSession(attempt,'original-bank','bad');mutate(s);expect(()=>validateFrozenSession(s)).toThrow()}
})
it('cannot reconstruct a v1 record from a different bank fingerprint',async()=>{
const bank=await preparePersonalQuiz(fixtureDataset)
const old=newAttempt(makeQuiz(bank.catalogs.A2,()=>0.4),'random')
const raw=saveAttempt(old,bank.revision)
expect(originalLegacySession(raw,bank)?.attempt).toEqual(old)
expect(originalLegacySession(raw,{...bank,revision:'different-bank'})).toBeNull()
expect(raw).toBe(saveAttempt(old,bank.revision))
})
it('archives an accurately reconstructed v1 session once, retaining its exact raw record',async()=>{
const bank=await preparePersonalQuiz(fixtureDataset)
const raw=saveAttempt(newAttempt(makeQuiz(bank.catalogs.A2,()=>0.4),'random'),bank.revision)
const session=originalLegacySession(raw,bank)!
const archive=addLegacyRecovery(null,{raw,session})
expect(addLegacyRecovery(archive,{raw,session})).toEqual(archive)
expect(readLegacySessions(archive).recoveries[0].raw).toBe(raw)
expect(readLegacySessions(archive).sessions[0].attempt.questions).toEqual(session.attempt.questions)
})
})
