import { expect, it } from 'vitest'
import { day, mergeStudyProgress, reviewSchedule, studyStats, type StudyEvent } from '../src/study-progress'

const time = Date.now() - 15 * day
const base: StudyEvent = { id: 'r1', questionId: 'q1', topic: 'A1:1:0', chapter: 'A1:1', type: 'grammar', time, result: 'correct' }

it('merges matching events idempotently and rejects conflicts and malformed history', () => {
  expect(mergeStudyProgress([base], [base])).toEqual([base])
  expect(() => mergeStudyProgress([base], [{ ...base, result: 'incorrect' }])).toThrow(/Conflicting/)
  expect(() => mergeStudyProgress([base], [{ ...base, result: 'known', id: 'r2' }])).toThrow(/Invalid/)
  expect(() => mergeStudyProgress([base], [{ ...base, time: Number.POSITIVE_INFINITY }])).toThrow(/Invalid/)
})

it('schedules reviews and resets the interval after a miss', () => {
  expect(reviewSchedule([base]).get('q1')).toEqual({ streak: 1, needsReview: false, due: time + day })
  const second = { ...base, id: 'r2', time: time + day }
  expect(reviewSchedule([base, second]).get('q1')?.due).toBe(time + 4 * day)
  const failure = { ...second, id: 'r3', time: time + 2 * day, result: 'incorrect' } as const
  expect(reviewSchedule([base, second, failure]).get('q1')).toEqual({ streak: 0, needsReview: true, due: failure.time })
  expect(studyStats([base, second]).mastered).toBe(false)
  expect(studyStats([base, { ...base, questionId: 'q2' }, { ...base, questionId: 'q3' }]).mastered).toBe(true)
})
