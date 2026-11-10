import { articles, type Level, type PilotEntry, type Reliability } from './pilot.ts'

export const questionCounts = [10, 20, 30, 50] as const
export type QuestionCount = (typeof questionCounts)[number]
export const defaultQuestionCount = questionCounts[0]
export const isQuestionCount = (value: unknown): value is QuestionCount =>
  questionCounts.some(count => value === count)
export const modes = ['de-ar', 'ar-de', 'article', 'verb', 'adjective'] as const
export type Mode = (typeof modes)[number]
export type Language = 'ar' | 'de'
export type Random = () => number

export interface Text {
  text: string
  lang: Language
}

export interface Choice extends Text {
  id: string
}

interface Fact {
  id: string
  entry: PilotEntry
  mode: Mode
  prompt: Text
  correct: Choice
  distractors: Choice[]
}

export interface Question {
  id: string
  entry: PilotEntry
  mode: Mode
  prompt: Text
  choices: Choice[]
  correctId: string
}

export interface Catalog {
  facts: Map<string, Fact>
  entryCount: number
  compatible: (left: string, right: string) => boolean
  equivalentEntries: Map<string, string>
}

export interface Attempt {
  kind: 'random' | 'retry'
  level: Level
  reliability: Reliability
  requestedCount: QuestionCount
  questions: Question[]
  answers: string[]
  index: number
  finished: boolean
}

interface Profile {
  entry: PilotEntry
  headword: string
  glossKey: string
  german: Set<string>
  arabic: Set<string>
}

export function shuffle<T>(values: readonly T[], random: Random = Math.random): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

function stripPunctuation(text: string) {
  return text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function withoutNotes(text: string) {
  return text.replace(/\s*\([^()]*\)/g, '').trim()
}

function germanKey(text: string) {
  return stripPunctuation(text.normalize('NFC').toLocaleLowerCase('de').replace(/ß/g, 'ss'))
    .replace(/^(der|die|das)\s+/, '')
}

function arabicKey(text: string) {
  return stripPunctuation(text.normalize('NFKC')
    .replace(/[\p{M}\u0640]/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه'))
}

function aliases(texts: string[], key: (text: string) => string) {
  return new Set(texts.flatMap(text => [text, withoutNotes(text)])
    .flatMap(text => text.split(/[\/،]/u)).map(key).filter(Boolean))
}

function overlaps(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  for (const value of left) if (right.has(value)) return true
  return false
}

function unrelated(left: Profile, right: Profile, nearMeanings: ReadonlySet<string>[]) {
  return left.entry.id !== right.entry.id &&
    !overlaps(left.german, right.german) &&
    !overlaps(left.arabic, right.arabic) &&
    !nearMeanings.some(group => overlaps(group, left.german) && overlaps(group, right.german))
}

function chooseThree(options: Choice[], compatible: Catalog['compatible']): Choice[] | undefined {
  for (let first = 0; first < options.length - 2; first++) {
    for (let second = first + 1; second < options.length - 1; second++) {
      if (!compatible(options[first].id, options[second].id)) continue
      const third = options.find((option, index) => index > second &&
        compatible(options[first].id, option.id) && compatible(options[second].id, option.id))
      if (third) return [options[first], options[second], third]
    }
  }
}

function choice(entry: PilotEntry, lang: Language): Choice {
  return {
    id: entry.id,
    text: lang === 'de' ? entry.german : entry.arabic_translations.join(' / '),
    lang,
  }
}

export function buildCatalog(
  entries: readonly PilotEntry[], level: Level = 'A2', strict = false,
  distractorGroups: readonly (readonly string[])[] = [],
): Catalog {
  const nearMeanings = distractorGroups.map(group => new Set(group.map(germanKey)))
  const homographsByWord = new Map<string, Profile[]>()
  const headwordsByGloss = new Map<string, Set<string>>()
  function glossAliases(texts: string[]) {
    const keys = aliases(texts, arabicKey)
    if (strict) for (const key of [...keys]) {
      // Treat Arabic glosses with or without a definite article as overlapping.
      keys.add(key.replace(/(^| )ال(?=\p{L}{3})/gu, '$1'))
    }
    return keys
  }
  const profiles = entries.map(entry => {
    const headword = germanKey(entry.german)
    const arabic = glossAliases(entry.arabic_translations)
    const profile = {
      entry, headword, arabic, glossKey: [...arabic].sort().join('|'),
      german: aliases([entry.german, ...entry.synonyms], germanKey),
    }
    const homographs = homographsByWord.get(headword) ?? []
    homographs.push(profile)
    homographsByWord.set(headword, homographs)
    for (const gloss of arabic) {
      const headwords = headwordsByGloss.get(gloss) ?? new Set<string>()
      headwords.add(headword)
      headwordsByGloss.set(gloss, headwords)
    }
    return profile
  })
  const byId = new Map(profiles.map(profile => [profile.entry.id, profile]))
  const compatible: Catalog['compatible'] = (left, right) => {
    const a = byId.get(left)
    const b = byId.get(right)
    return Boolean(a && b && unrelated(a, b, nearMeanings))
  }
  const facts = new Map<string, Fact>()
  const add = (fact: Fact) => facts.set(fact.id, fact)

  let eligibleProfiles = profiles.filter(profile =>
    profile.entry.levels.includes('A1') || (level === 'A2' && profile.entry.levels.includes('A2'))
  )
  const equivalentEntries = new Map<string, string>()
  if (strict) {
    const canonical = new Map<string, Profile>()
    // Reviewed records arrive first. Among automatic records, retain an A1
    // representative when available so its identifier is stable across levels.
    for (const profile of eligibleProfiles) {
      const { entry } = profile
      const identity = JSON.stringify([entry.german, entry.part_of_speech, entry.article,
        [...entry.arabic_translations].sort()])
      const representative = canonical.get(identity)
      if (representative) {
        equivalentEntries.set(entry.id, representative.entry.id)
        for (const alias of profile.german) representative.german.add(alias)
      } else {
        canonical.set(identity, profile)
      }
    }
    eligibleProfiles = [...canonical.values()]
  }
  const canTranslate = ({ entry, headword, glossKey }: Profile) =>
    entry.quiz.german_to_arabic &&
    homographsByWord.get(headword)?.every(profile => profile.glossKey === glossKey)
  const arabicChoices = new Map(eligibleProfiles.map(({ entry }) => [entry.id, choice(entry, 'ar')]))
  const germanChoices = new Map(eligibleProfiles.map(({ entry }) => [entry.id, choice(entry, 'de')]))
  const byPart = new Map<PilotEntry['part_of_speech'], Profile[]>()
  for (const profile of eligibleProfiles) {
    if (strict && !canTranslate(profile)) continue
    const part = profile.entry.part_of_speech
    const group = byPart.get(part) ?? []
    group.push(profile)
    byPart.set(part, group)
  }
  // Keep all verified profiles for ambiguity checks, while all offered words
  // and distractors must come from the selected level.
  for (const profile of eligibleProfiles) {
    const { entry, headword } = profile
    const { id, german, article, quiz, part_of_speech } = entry
    const germanPrompt: Text = { text: german, lang: 'de' }
    const homographs = homographsByWord.get(headword) ?? []

    if (quiz.article && article && homographs.every(profile => profile.entry.article === article)) {
      add({
        id: id + ':article', entry, mode: 'article', prompt: germanPrompt,
        correct: { id: article, text: article, lang: 'de' },
        distractors: articles.filter(value => value !== article)
          .map(value => ({ id: value, text: value, lang: 'de' })),
      })
    }

    const pool = (byPart.get(part_of_speech) ?? []).filter(profile => compatible(id, profile.entry.id))
    const arabicOptions = pool.map(({ entry }) => arabicChoices.get(entry.id)!)
    if (canTranslate(profile) && chooseThree(arabicOptions, compatible)) {
      const forwardModes: Mode[] = ['de-ar']
      if (quiz.verb_translation) forwardModes.push('verb')
      if (quiz.adjective_translation) forwardModes.push('adjective')
      for (const mode of forwardModes) {
        add({
          id: id + ':' + mode, entry, mode, prompt: germanPrompt,
          correct: choice(entry, 'ar'), distractors: arabicOptions,
        })
      }
    }

    if (!quiz.arabic_to_german_prompts.length) continue
    const germanOptions = pool.map(({ entry }) => germanChoices.get(entry.id)!)
    if (!chooseThree(germanOptions, compatible)) continue
    for (const [index, prompt] of quiz.arabic_to_german_prompts.entries()) {
      const promptKeys = glossAliases([prompt])
      const ambiguous = [...promptKeys].some(key => {
        const headwords = headwordsByGloss.get(key)
        return headwords && (headwords.size > 1 || !headwords.has(headword))
      })
      if (ambiguous) continue
      add({
        id: id + ':ar-de:' + index, entry, mode: 'ar-de', prompt: { text: prompt, lang: 'ar' },
        correct: choice(entry, 'de'), distractors: germanOptions,
      })
    }
  }

  return { facts, compatible, equivalentEntries,
    entryCount: new Set([...facts.values()].map(fact => germanKey(fact.entry.german))).size }
}

function question(fact: Fact, choices: Choice[]): Question {
  return {
    id: fact.id, entry: fact.entry, mode: fact.mode, prompt: fact.prompt,
    correctId: fact.correct.id, choices,
  }
}

export function makeQuiz(
  catalog: Catalog, random: Random = Math.random, count: QuestionCount = defaultQuestionCount,
): Question[] {
  const available = shuffle([...catalog.facts.values()], random)
  const selected: Fact[] = []
  const used = new Set<string>()
  const key = (fact: Fact) => germanKey(fact.entry.german)
  const add = (fact: Fact) => {
    selected.push(fact)
    used.add(key(fact))
  }
  // Give each mode a chance before filling the remaining slots at random.
  for (const mode of shuffle(modes, random)) {
    const fact = available.find(candidate => candidate.mode === mode && !used.has(key(candidate)))
    if (fact) add(fact)
  }
  for (const fact of available) {
    if (selected.length >= count) break
    if (!used.has(key(fact))) add(fact)
  }

  return shuffle(selected, random).map(fact => {
    const distractors = fact.mode === 'article'
      ? fact.distractors
      : chooseThree(shuffle(fact.distractors, random), catalog.compatible)
    if (!distractors) throw new Error('A fact lost its safe distractors.')
    return question(fact, shuffle([fact.correct, ...distractors], random))
  })
}

export function isCorrect(question: Question, selected: string) {
  return selected === question.correctId
}

export function incorrectAnswers(attempt: Attempt) {
  return attempt.questions.flatMap((question, index) => {
    const selected = attempt.answers[index]
    return selected && !isCorrect(question, selected)
      ? [{ question, selected: question.choices.find(choice => choice.id === selected)! }]
      : []
  })
}

export function retryQuiz(attempt: Attempt, random: Random = Math.random): Question[] {
  return shuffle(incorrectAnswers(attempt), random).map(({ question }) => {
    const choices = shuffle(question.choices, random)
    if (choices.every((choice, index) => choice.id === question.choices[index].id)) {
      choices.push(choices.shift()!)
    }
    return { ...question, choices }
  })
}

export function newAttempt(
  questions: Question[], kind: Attempt['kind'], level: Level = 'A2',
  requestedCount: QuestionCount = defaultQuestionCount, reliability: Reliability = 'reviewed',
): Attempt {
  return { kind, level, reliability, requestedCount, questions, answers: [], index: 0, finished: false }
}

export function answer(attempt: Attempt, selected: string): Attempt {
  if (attempt.finished || attempt.answers.length !== attempt.index ||
      !attempt.questions[attempt.index]?.choices.some(choice => choice.id === selected)) return attempt
  return { ...attempt, answers: [...attempt.answers, selected] }
}

export function nextQuestion(attempt: Attempt): Attempt {
  if (attempt.finished || attempt.answers.length !== attempt.index + 1) return attempt
  return attempt.index === attempt.questions.length - 1
    ? { ...attempt, finished: true }
    : { ...attempt, index: attempt.index + 1 }
}

export function restoreQuestion(catalog: Catalog, factId: string, orderedIds: string[]) {
  const fact = catalog.facts.get(factId)
  if (!fact || new Set(orderedIds).size !== (fact.mode === 'article' ? 3 : 4) ||
      new Set(orderedIds).size !== orderedIds.length || !orderedIds.includes(fact.correct.id)) return
  const distractors = orderedIds.filter(id => id !== fact.correct.id)
  if (fact.mode !== 'article' &&
      distractors.some((id, index) => distractors.slice(index + 1).some(other => !catalog.compatible(id, other)))) return
  const options = [fact.correct, ...fact.distractors]
  const ordered = orderedIds.map(id => options.find(choice => choice.id === id))
  if (ordered.every((choice): choice is Choice => Boolean(choice))) return question(fact, ordered)
}
