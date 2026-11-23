import assert from 'node:assert/strict'

// An explicit source correction or example append is not permission to rewrite
// IDs, review states, original evidence, prior examples or unrelated fields.
export function assertPreservedVocabulary(before,after,ledger){
 const corrections=ledger?.arabicCorrections??[],examples=ledger?.examples??[]
 if(ledger)assert.equal(ledger.humanVerified,false)
 for(let i=0;i<before.entries.length;i++){
  const old=before.entries[i],fresh=after.entries[i],copy=structuredClone(fresh)
  assert.equal(fresh.id,old.id)
  assert.deepEqual(fresh.examples.slice(0,old.examples.length),old.examples)
  const append=examples.filter(e=>e.entryId===old.id)
  assert.equal(fresh.examples.length,old.examples.length+append.length)
  for(const item of append){
   assert.equal(item.humanVerified,false)
   const actual=fresh.examples.find(e=>e.german===item.german&&e.arabic===item.arabic)
   assert(actual&&actual.source_type===item.source_type)
   assert(!/human|manually|^reviewed$/u.test(actual.verificationStatus))
  }
  copy.examples=old.examples
  if(append.length)copy.incompleteExampleLevels=old.incompleteExampleLevels
  const change=corrections.find(c=>before.sourceRows.find(r=>r.id===c.rowId)?.combined_id===old.id)
  if(change){
   assert.deepEqual(old.arabic_translations,change.original)
   assert.deepEqual(fresh.arabic_translations,change.corrected)
   assert.equal(change.verification,'ai_pdf_visual_review')
   const expected={...old.quiz,arabic_to_german_prompts:old.quiz.arabic_to_german_prompts.map(p=>change.corrected[change.original.indexOf(p)]??p)}
   assert.deepEqual(fresh.quiz,expected)
   copy.arabic_translations=old.arabic_translations;copy.quiz=old.quiz
  }
  assert.deepEqual(copy,old)
 }
 for(let i=0;i<before.sourceRows.length;i++){
  const old=before.sourceRows[i],fresh=after.sourceRows[i],copy=structuredClone(fresh)
  assert.equal(fresh.id,old.id)
  const append=examples.filter(e=>e.entryId===old.combined_id)
  assert.deepEqual(fresh.examples.slice(0,old.examples.length),old.examples)
  assert.equal(fresh.examples.length,old.examples.length+append.length)
  copy.examples=old.examples
  const change=corrections.find(c=>c.rowId===old.id)
  if(change){
   assert.equal(change.sourcePage,old.source_page)
   assert.deepEqual(old.arabic_translations,change.original)
   assert.deepEqual(fresh.arabic_translations,change.corrected)
   assert.deepEqual(fresh.arabic_logical_lines,change.corrected)
   copy.arabic_translations=old.arabic_translations;copy.arabic_logical_lines=old.arabic_logical_lines;copy.review_fingerprint=old.review_fingerprint
  }
  assert.deepEqual(copy,old)
 }
}
