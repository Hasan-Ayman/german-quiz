import type { PersonalQuiz } from './personal-quiz.ts'
import type { PersonalEntry } from './personal-data.ts'
import { arabicKey, germanKey } from './quiz.ts'
import type { StudyQuestion } from './study-content.ts'
import { fromStudyQuestion, type Scope } from './practice.ts'

export function matchingCandidates(bank: PersonalQuiz, scope: Scope, expanded: boolean) {
  const level = scope === 'A1' ? 'A1' : 'A2'
  const catalog = expanded ? bank.getExpandedCatalog(level) : bank.catalogs[level]
  const pools = new Map<string, { entry: PersonalEntry; arabic: string; page: number }[]>()
  for (const fact of catalog.facts.values()) {
    if (fact.mode !== 'de-ar') continue
    const entry = fact.entry as PersonalEntry
    const usedChapters = new Set<string>()
    for (const ref of entry.sources) {
      if (scope !== 'all' && ref.level !== scope) continue
      const chapter = ref.level + ':' + ref.chapter
      if (usedChapters.has(chapter)) continue
      usedChapters.add(chapter)
      const poolKey = chapter + ':' + entry.vocabularyStatus
      const pool = pools.get(poolKey) ?? []
      pool.push({ entry, arabic: fact.correct.text, page: ref.page })
      pools.set(poolKey, pool)
    }
  }

  const result = []
  for (const [poolKey, input] of pools) {
    const chapter = poolKey.split(':').slice(0, 2).join(':')
    const document = chapter.startsWith('A1') ? 'a1-vocab' : 'a2-vocab'
    const pool = input.sort((a, b) => a.entry.id.localeCompare(b.entry.id))
    const used = new Set<string>()
    for (const first of pool) {
      if (used.has(first.entry.id)) continue
      const group = [first]
      for (const other of pool) {
        if (other === first || used.has(other.entry.id) || group.includes(other)) continue
        const compatible = group.every(item => catalog.compatible(item.entry.id, other.entry.id) &&
          germanKey(item.entry.german) !== germanKey(other.entry.german) && arabicKey(item.arabic) !== arabicKey(other.arabic))
        if (compatible) group.push(other)
        if (group.length === 3) break
      }
      if (group.length < 2) continue
      for (const item of group) used.add(item.entry.id)
      const pairs = group.map(({ entry, arabic, page }) => ({ german: entry.german, arabic, source: { document, page } } as const))
      const id = 'match:' + chapter + ':' + stableKey(group.map(item => item.entry.id).join(':'))
      const item: StudyQuestion = { id, chapter, type: 'matching', topic: '', origin: 'vocabulary',
        verification: first.entry.vocabularyStatus === 'reviewed' ? 'reviewed' : 'automated_checked', pairs,
        instruction: 'طابق الكلمات الألمانية مع معانيها', prompt: pairs.map(pair => pair.german).join(' · '),
        source: pairs[0].source, answers: [pairs.map(pair => pair.arabic).join(' | ')],
        answerLanguage: 'ar', explanation: 'قارن الكلمة الألمانية بمعناها في كل زوج.', german: '', arabic: '' }
      result.push(fromStudyQuestion(item))
    }
  }
  return result
}

function stableKey(text: string) {
  let hash = 14695981039346656037n
  for (const letter of text) hash = BigInt.asUintN(64, (hash ^ BigInt(letter.codePointAt(0)!)) * 1099511628211n)
  return hash.toString(16)
}
