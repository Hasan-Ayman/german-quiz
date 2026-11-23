import {describe,it,expect} from 'vitest'
import {classifyOccurrence} from '../scripts/classify_context_forms.mjs'
const index={lemmas:new Map([['lernen',[{id:'fixture',part:'verb'}]]]),folded:new Map([['lernen',[{id:'fixture',part:'verb'}]]]),forms:new Map([['lernte',[{field:'printed_past'}]]])}
const occurrence=(surface:string,context=surface,top=180)=>({surface,context,top,pageHeight:840,document:'fixture'})
describe('conservative contextual classification',()=>{
 it('keeps explicit printed inflections separate from lemma occurrences',()=>{
 expect(classifyOccurrence(occurrence('lernen'),index).category).toBe('existing_vocabulary_occurrences')
 expect(classifyOccurrence(occurrence('lernte'),index).category).toBe('inflected_forms')
 expect(classifyOccurrence(occurrence('lernst'),index).category).toBe('unresolved')
 })
 it('does not case-fold a capitalized ambiguous role into a lower-case verb',()=>{
 expect(classifyOccurrence(occurrence('Lernen'),index).category).toBe('unresolved')
 expect(classifyOccurrence(occurrence('lernen'),index,{ambiguous:['lernen']}).category).toBe('unresolved')
 })
 it('uses local line/coordinate context for instructions instead of deleting words',()=>{
 expect(classifyOccurrence(occurrence('lernen','Schreiben Sie etwas.'),index).category).toBe('exercise_instructions')
 expect(classifyOccurrence(occurrence('lernen','lernen',810),index).category).toBe('exercise_instructions')
 expect(classifyOccurrence(occurrence('lernen','Person: lernen'),index).category).toBe('existing_vocabulary_occurrences')
 })
 it('keeps whole noun candidates unapproved and never guesses unknown spelling',()=>{
 const candidate=classifyOccurrence(occurrence('Testnomen','das Testnomen'),index)
 expect(candidate.category).toBe('valid_new_lexical_candidates');expect(candidate.active).toBe(false);expect(candidate.humanVerified).toBe(false)
 expect(classifyOccurrence(occurrence('txxt'),index).category).toBe('unresolved')
 })
 it('preserves the input while distinguishing explicit source names and artifacts',()=>{
 const input=occurrence('Testname'),old=structuredClone(input)
 expect(classifyOccurrence(input,index,{names:['Testname']}).category).toBe('proper_names');expect(input).toEqual(old)
 expect(classifyOccurrence(occurrence('txxt'),index,{artifacts:['txxt']}).category).toBe('extraction_artifacts')
 })
})
