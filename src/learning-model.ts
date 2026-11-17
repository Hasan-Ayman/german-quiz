import { day, type StudyEvent } from './study-progress.ts'
import type { Activity, Candidate, Preferences } from './practice.ts'

export type Mastery = 'learning' | 'review' | 'improving' | 'strong' | 'mastered'
export const masteryLabels: Record<Mastery, string> = {
  learning: 'قيد التعلّم', review: 'تحتاج مراجعة', improving: 'في تحسّن', strong: 'راسخة', mastered: 'متقنة',
}
export const incorrect = (event: StudyEvent) => event.result === 'incorrect' || event.result === 'missed'
export const graded = (event: StudyEvent) => event.result === 'correct' || event.result === 'incorrect'
export const activityOf = (event: StudyEvent): Activity => event.activity ?? event.type
const intervals = [1, 3, 7, 14, 30]

export interface Evidence {
  id: string
  history: StudyEvent[]
  last: StudyEvent
  firstMistake?: StudyEvent
  lastMistake?: StudyEvent
  errors: number
  reviews: number
  lastReview?: number
  spacedSuccesses: number
  stage: Mastery
  due: number
  resolved: boolean
}

export function buildEvidence(events: readonly StudyEvent[]) {
  const byId = new Map<string, Evidence>()
  const ordered = [...events].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
  for (const event of ordered) {
    if (event.result === 'completed') continue
    let item = byId.get(event.questionId)
    if (!item) {
      item = { id: event.questionId, history: [], last: event, errors: 0,
        reviews: 0, spacedSuccesses: 0, stage: 'learning', due: event.time, resolved: false }
      byId.set(item.id, item)
    }
    updateEvidence(item, event)
  }
  return byId
}

function updateEvidence(item: Evidence, event: StudyEvent) {
  const atReview = item.history.length > 0 && event.time >= item.due
  if (atReview) item.lastReview = event.time
  if (incorrect(event)) {
    item.firstMistake ??= event
    item.lastMistake = event
    item.errors++
    item.spacedSuccesses = 0
    item.resolved = false
    item.stage = 'review'
    // Old mistakes were due immediately. Schedule new mistakes for a later review.
    item.due = event.time + (event.evidenceVersion === 2 ? day / 4 : 0)
  } else {
    const initial = item.spacedSuccesses === 0
    const spaced = !initial && event.time >= item.due
    if (atReview) item.reviews++
    if (initial || spaced) {
      item.spacedSuccesses++
      item.due = event.time + day * intervals[Math.min(item.spacedSuccesses - 1, intervals.length - 1)]
    }
    const count = item.spacedSuccesses
    // Three retrievals can occur after only four days. Require a fourth for stable mastery.
    item.stage = count >= 4 ? 'mastered' : count >= 3 ? 'strong' : item.errors ? 'improving' : 'learning'
    item.resolved = item.errors > 0 && item.stage === 'mastered'
  }
  item.history.push(event)
  item.last = event
}

export function masterySummary(items: Iterable<Evidence>) {
  let touched = 0
  let mastered = 0
  let supported = 0
  for (const item of items) {
    touched++
    if (item.stage === 'mastered') mastered++
    if (item.spacedSuccesses >= 2 || item.errors >= 2) supported++
  }
  return { touched, mastered, value: touched >= 3 && supported >= 3 ? mastered / touched : null }
}

export function scopesMatch(chapter: string, filter: { level: string; chapter: string }) {
  return (!filter.level || chapter.startsWith(filter.level + ':')) && (!filter.chapter || chapter === filter.chapter)
}

export function reviewOrder(items: readonly Evidence[], now: number) {
  return [...items].sort((a, b) => Number(b.due <= now) - Number(a.due <= now) ||
    b.errors - a.errors || a.spacedSuccesses - b.spacedSuccesses || a.due - b.due ||
    (b.lastMistake?.time ?? 0) - (a.lastMistake?.time ?? 0) || a.id.localeCompare(b.id))
}

export type SupportLevel = 'guided' | 'standard' | 'recall'
export function difficultyByActivity(events: readonly StudyEvent[]) {
  const latest = new Map<Activity, StudyEvent[]>()
  for (const event of events) {
    if (!graded(event)) continue
    const key = activityOf(event)
    const items = latest.get(key) ?? []
    items.push(event)
    if (items.length > 12) items.shift()
    latest.set(key, items)
  }
  return new Map([...latest].map(([activity, items]): [Activity, SupportLevel] => {
    const accuracy = items.filter(item => item.result === 'correct').length / items.length
    const spread = items[items.length - 1].time - items[0].time
    const level = items.length >= 8 && spread >= day && accuracy >= .83 ? 'recall'
      : items.length >= 4 && accuracy < .5 ? 'guided' : 'standard'
    return [activity, level]
  }))
}

type Bucket = 'due' | 'weak' | 'new' | 'maintenance'
const pattern: Bucket[] = ['due', 'new', 'weak', 'due', 'new', 'weak', 'due', 'new', 'due', 'new']

function tieBreak(key: string, seed: number) {
  let hash = seed | 0
  for (const letter of key) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619)
  return (hash >>> 0) / 2 ** 32
}

export function adaptiveRound(groups: ReadonlyMap<string, Candidate[]>, count: Preferences['count'],
  learned: ReadonlyMap<string, Evidence>, now: number, seed: number) {
  const buckets: Record<Bucket, { item: Candidate; score: number }[]> = { due: [], weak: [], new: [], maintenance: [] }
  for (const candidates of groups.values()) {
    for (const item of candidates) {
      const progress = learned.get(item.id)
      const due = progress !== undefined && progress.due <= now
      const weak = progress && ['review', 'improving', 'learning'].includes(progress.stage) && now - progress.last.time >= day / 4
      const bucket = due ? 'due' : !progress ? 'new' : weak ? 'weak' : 'maintenance'
      const timeWeight = progress ? Math.min(7, (now - progress.last.time) / day) : 0
      const score = (progress ? Math.min(progress.errors, 6) * 2 : 0) + timeWeight -
        (progress?.stage === 'mastered' ? 12 : 0) + tieBreak(item.id, seed)
      buckets[bucket].push({ item, score })
    }
  }
  const size = count === 'all' ? groups.size : Math.min(groups.size, count)
  const order: Bucket[] = ['due', 'new', 'weak', 'maintenance']
  for (const bucket of order) buckets[bucket].sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
  const used = new Set<string>()
  const result: Candidate[] = []
  const covered = new Set<string>()
  while (result.length < size) {
    const picks = [...new Set([pattern[result.length % pattern.length], ...order])]
    let found = false
    for (const key of picks) {
      const options = buckets[key]
      while (options.length && used.has(options[0].item.key)) options.shift()
      if (!options.length) continue
      // Among similarly ranked candidates, prefer coverage of selected types and chapters.
      const window = options.slice(0, 32)
      const breadth = (item: Candidate) => Number(!covered.has(item.chapter)) + Number(!covered.has(item.activity))
      let best = 0
      for (let i = 1; i < window.length; i++) {
        if (used.has(window[i].item.key) || window[i].score < window[0].score - 2) continue
        if (breadth(window[i].item) > breadth(window[best].item)) best = i
      }
      const [{ item }] = options.splice(best, 1)
      used.add(item.key)
      covered.add(item.chapter)
      covered.add(item.activity)
      result.push(item)
      found = true
      break
    }
    if (!found) break
  }
  return result
}
