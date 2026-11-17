import { normalizeStudyAnswer, studyLevel, type StudyPack, type StudyQuestion, type StudyType } from './study-content.ts'

export type StudyFilter = {
  level: 'A1' | 'A2' | 'all'
  chapters: string[]
  type: StudyType | 'all'
  topic?: string
}

export function studyPool(pack: StudyPack, filters: StudyFilter) {
  return pack.questions.filter(question => (filters.level === 'all' || studyLevel(question.chapter) === filters.level) &&
    (!filters.chapters.length || filters.chapters.includes(question.chapter)) &&
    (filters.type === 'all' || filters.type === question.type) &&
    (!filters.topic || filters.topic === question.topic))
}

export function checkStudyAnswer(question: StudyQuestion, answer: string) {
  const lang = question.answerLanguage ?? (question.type === 'reading' || question.type === 'flashcard' ? 'ar' : 'de')
  const guess = normalizeStudyAnswer(answer, lang)
  return Boolean(guess && question.answers.some(value => normalizeStudyAnswer(value, lang) === guess))
}

export function shuffled<T>(items: readonly T[], rng = Math.random) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function shuffledStudyTokens(tokens: readonly string[], rng = Math.random) {
  const result = shuffled(tokens.map((text, i) => ({ text, i })), rng)
  if (result.length > 1 && result.every((token, i) => token.text === tokens[i])) {
    const split = result.findIndex(token => token.text !== result[0].text)
    if (split > 0) return [...result.slice(split), ...result.slice(0, split)]
  }
  return result
}

const practiceKey = (item: StudyQuestion) => item.practiceKey ? 'vocabulary:' + item.practiceKey :
  item.type === 'flashcard' && item.origin === 'vocabulary' ? item.id : item.chapter + ':' + item.german

export function studyRound(pool: readonly StudyQuestion[], count: number, rng = Math.random) {
  if (!Number.isInteger(count) || count < 1) return []
  // A chapter can teach one fact through multiple interactions. Test it once per mixed round.
  const included = new Set<string>()
  const result: StudyQuestion[] = []
  for (const item of shuffled(pool, rng)) {
    const key = practiceKey(item)
    if (included.has(key)) continue
    included.add(key)
    result.push(item)
    if (result.length >= count) break
  }
  return result
}

export function studyAssessment(pool: StudyQuestion[], count: number, rng = Math.random) {
  if (!Number.isInteger(count) || count < 1) return []
  const candidates = shuffled(pool, rng)
  const selected: StudyQuestion[] = []
  const used = new Set<string>()
  for (const type of ['reading', 'cloze', 'vocabulary', 'verb']) {
    if (selected.length >= count) break
    const first = candidates.find(item => item.type === type && !used.has(practiceKey(item)))
    if (!first) continue
    selected.push(first)
    used.add(practiceKey(first))
  }
  return shuffled([...selected, ...studyRound(candidates.filter(item => !used.has(practiceKey(item))), count - selected.length, rng)], rng)
}
