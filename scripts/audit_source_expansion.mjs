import assert from 'node:assert/strict'
import {assertPreservedVocabulary} from './assert_preserved_vocabulary.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
const folder = resolve(process.argv[2] ?? '')
const content = JSON.parse(readFileSync(resolve(folder, process.argv[3] ?? 'german-quiz-complete-private.json'), 'utf8'))
const originals = JSON.parse(readFileSync(resolve(folder, process.argv[4] ?? 'original-education.backup.json'), 'utf8'))
const {questionExclusions:currentExclusions,entries:currentEntries,sourceRows:currentRows,distractorGroups:currentGroups,...currentWords}=content.vocabulary
const {questionExclusions:previousExclusions,entries:previousEntries,sourceRows:previousRows,distractorGroups:previousGroups,...previousWords}=originals.vocabulary
assert.deepEqual(currentWords, previousWords)
// An already-applied review ledger is not a new modification allowance.
const engineering=content.contentEngineering??{}
const ledgers=[engineering.reviewSupplement,...(engineering.exampleBatches??[])].filter(Boolean)
const applicable=ledgers.filter(ledger=>ledger.baselineSha256 && ledger.baselineSha256!==originals.contentEngineering?.reviewSupplement?.baselineSha256)
const pendingExamples=applicable.flatMap(ledger=>ledger.examples??[]).filter(item=>{
 const prior=originals.vocabulary.entries.find(e=>e.id===item.entryId)
 return prior&&!prior.examples.some(e=>e.german===item.german&&e.arabic===item.arabic)
})
const pendingCorrections=applicable.flatMap(ledger=>ledger.arabicCorrections??[]).filter(item=>{
 const prior=originals.vocabulary.sourceRows.find(r=>r.id===item.rowId)
 return prior&&JSON.stringify(prior.arabic_translations)===JSON.stringify(item.original)
})
assertPreservedVocabulary(originals.vocabulary,content.vocabulary,{humanVerified:false,examples:pendingExamples,arabicCorrections:pendingCorrections})
assert.deepEqual(currentGroups.slice(0,previousGroups.length),previousGroups)
assert(currentEntries.slice(previousEntries.length).every(e=>e.vocabularyStatus==='automatically_validated'&&e.sources.every(s=>s.document?.endsWith('-book'))),'Unexpected canonical additions')
const phrases = new Set()
for(const record of content.feedback??[]){
  if(record.text.length>=28)phrases.add(record.text)
  for(const note of Object.values(record.options??{}))if(note.length>=28)phrases.add(note)
}
for (const row of [...content.vocabulary.entries, ...(content.vocabulary.sourceRows ?? [])]) {
  for (const example of row.examples ?? []) {
    for (const value of [example.german, example.arabic]) if (typeof value === 'string' && value.length >= 28) phrases.add(value)
  }
}
for (const passage of content.study.readingPassages ?? []) {
  for (const value of [passage.german, passage.arabic]) {
    phrases.add(value)
    // Overlapping substantial fragments catch accidental partial bundling too.
    for (let i = 0; i + 60 < value.length; i += 30) phrases.add(value.slice(i, i + 60))
  }
}
for (const lesson of content.study.lessons.filter(item => item.origin === 'source_derived')) {
  for (const value of [lesson.explanation, lesson.german, lesson.arabic]) if (value.length >= 28) phrases.add(value)
}
for (const question of content.study.questions.filter(item => item.sourceActivityRef)) {
  for (const value of [question.prompt, question.explanation]) if (value.length >= 28) phrases.add(value)
}
const markers = content.study.questions.filter(item => item.origin === 'source_derived').map(item => item.id)
const vocabularyIds = [...content.vocabulary.entries, ...(content.vocabulary.sourceRows ?? [])].map(item => item.id)
const normalize = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim()
const needles = [...phrases].map(text => [normalize(text), normalize(JSON.stringify(text).slice(1, -1))])
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const build = readdirSync('dist', { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))
for (const path of [...tracked, ...untracked, ...build]) {
  assert(!/\.pdf$|complete-private.*\.json$|german-quiz-final-complete\.json$|(?:^|[\\/])(?:private|reports|data|source-pdfs)[\\/]/iu.test(path), 'Private path: ' + path)
  const bytes = readFileSync(path)
  assert(bytes.subarray(0, 5).toString() !== '%PDF-', 'PDF signature')
  if (!/\.(?:[cm]?js|tsx?|css|html|json|md|py|yml|webmanifest|svg)$/iu.test(path)) continue
  const body = normalize(bytes.toString('utf8'))
  assert(!markers.some(id => body.includes(id)), 'Private question identity in ' + path)
  assert(!vocabularyIds.some(id => body.includes(id)), 'Private vocabulary identity in ' + path)
  assert(!needles.some(pair => pair.some(text => body.includes(text))), 'Private reading fragment in ' + path)
}
const result = { trackedFiles: tracked.length, untrackedCodeFiles: untracked.length, publicFiles: build.length,
  substantialPrivateFragments: needles.length, privateVocabularyIds: vocabularyIds.length, newPrivateQuestionIds: markers.length, matches: 0 }
writeFileSync(join(folder, 'expanded-privacy-audit.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
