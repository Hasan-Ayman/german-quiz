import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { entries, fixtureDataset, rawPilot } from './fixtures'
import { LanguageText, QuizApp, QuizPanel, Results } from '../src/App'
import { preparePersonalQuiz } from '../src/personal-quiz'
import { VocabularyFile } from '../src/VocabularyFile'
import { automaticExampleApproval, readVerifiedPilot } from '../src/pilot'
import { answer, buildCatalog, makeQuiz, newAttempt, nextQuestion, type Attempt, type Mode } from '../src/quiz'

const catalog = buildCatalog(entries)
const renderPanel = (attempt: Attempt) =>
  renderToStaticMarkup(<QuizPanel attempt={attempt} select={() => {}} advance={() => {}} />)

function renderQuestion(mode: Mode) {
  const fact = [...catalog.facts.values()].find(fact => fact.mode === mode)!
  const [question] = makeQuiz({ ...catalog, facts: new Map([[fact.id, fact]]) }, () => .5)
  const initial = newAttempt([question], 'random')
  const wrong = question.choices.find(choice => choice.id !== question.correctId)!
  const markup = renderPanel(answer(initial, wrong.id))
  return { markup, question }
}

it('declares an Arabic RTL document and isolates Arabic and German with their language and direction', () => {
  expect(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).toContain('<html lang="ar" dir="rtl">')
  const german = entries.find(entry => /[ßäöü]/u.test(entry.german))!.german
  const arabic = entries.find(entry => /\p{M}/u.test(entry.arabic_translations[0]))!.arabic_translations[0]
  expect(renderToStaticMarkup(<LanguageText text={german} lang="de" />))
    .toBe('<bdi lang="de" dir="ltr">' + german + '</bdi>')
  expect(renderToStaticMarkup(<LanguageText text={arabic} lang="ar" />))
    .toBe('<bdi lang="ar" dir="rtl">' + arabic + '</bdi>')
})

it('renders the level and round options with A2 and 10 selected by default', async () => {
  const home = renderToStaticMarkup(<QuizApp bank={await preparePersonalQuiz(fixtureDataset)} />)
  const options = [...home.matchAll(/<option value="([^"]+)"( selected="")?>/g)]
  expect(options.map(option => option[1])).toEqual(['A1', 'A2', '10', '20', '30', '50', 'reviewed', 'with-automatic'])
  expect(options.filter(option => option[2]).map(option => option[1])).toEqual(['A2', '10', 'reviewed'])
})

it('offers a local file picker before a personal dataset is available', () => {
  const home = renderToStaticMarkup(<VocabularyFile bank={null} onImport={async () => {}} storageFailed={false} />)
  expect(home).toContain('ابدأ باستيراد مفرداتك')
  expect(home).toContain('type="file"')
  expect(home).not.toContain('تنزيل ملف المفردات')
})

it('shows a verified German example after answering and hides it beforehand', () => {
  const fact = [...catalog.facts.values()].find(fact => fact.entry.examples.some(example => example.origin === 'source_pdf'))!
  const [question] = makeQuiz({ ...catalog, facts: new Map([[fact.id, fact]]) }, () => .5)
  const attempt = newAttempt([question], 'random')
  const example = question.entry.examples.find(example => example.origin === 'source_pdf')!
  expect(renderPanel(attempt)).not.toContain('جملة مثال')
  expect(renderPanel(attempt)).not.toContain(example.german)
  const after = renderPanel(answer(attempt, question.correctId))
  expect(after).toContain('جملة مثال')
  expect(after).toContain('من المصدر')
  expect(after).toContain('<p lang="de" dir="ltr">' + example.german + '</p>')
  expect(after).not.toContain('<p lang="ar" dir="rtl">')
})

it('shows the local automatic approval and both sentence directions only after answering', () => {
  const [question] = makeQuiz(catalog, () => .5)
  const german = 'Das ist ein Beispielsatz.'
  const arabic = 'هذه جملة توضيحية.'
  const attempt = newAttempt([{ ...question, entry: { ...question.entry, examples: [{
    entryId: question.entry.id, level: 'A2', german, arabic, origin: 'authored',
    localApproval: automaticExampleApproval, verificationStatus: automaticExampleApproval,
  }] } }], 'random', 'A2')
  const before = renderPanel(attempt)
  expect(before).not.toContain(german)
  expect(before).not.toContain(arabic)
  const after = renderPanel(answer(attempt, question.correctId))
  expect(after).toContain('معتمد آليًا للاستخدام المحلي')
  expect(after).toContain('<p lang="de" dir="ltr">' + german + '</p>')
  expect(after).toContain('<p lang="ar" dir="rtl">' + arabic + '</p>')
})

it('suppresses unverified source examples and renders explicit verified Arabic right to left', () => {
  const raw = rawPilot
  const row = raw.find(entry => entry.german === 'aktiv')!
  const parsed = readVerifiedPilot([row])[0]
  expect(parsed.examples.map(example => example.level)).toEqual(['A2'])
  const a1Catalog = buildCatalog(entries, 'A1')
  const fact = [...a1Catalog.facts.values()].find(fact => fact.entry.id === parsed.id)!
  const [question] = makeQuiz({ ...a1Catalog, facts: new Map([[fact.id, fact]]) }, () => .5)
  const a1 = newAttempt([{ ...question, entry: parsed }], 'random', 'A1')
  expect(renderPanel(answer(a1, question.correctId))).not.toContain('جملة مثال')

  const arabic = 'نصّ اختباري'
  const withExplicitArabic = readVerifiedPilot([{ ...row, sources: row.sources.map(source =>
    ({ ...source, example_arabic_translation: arabic })) }])[0]
  expect(withExplicitArabic.examples).toHaveLength(1)
  const translated = newAttempt([{ ...question, entry: withExplicitArabic }], 'random', 'A2')
  const markup = renderPanel(answer(translated, question.correctId))
  expect(markup).toContain('<p lang="ar" dir="rtl">' + arabic + '</p>')

  const authoredTranslation = newAttempt([{ ...question, entry: {
    ...withExplicitArabic, examples: withExplicitArabic.examples.map(example =>
      example.origin === 'source_pdf' ? { ...example, arabicOrigin: 'authored' } : example),
  } }], 'random', 'A2')
  expect(renderPanel(authoredTranslation)).not.toContain('ترجمة عربية مضافة')
  expect(renderPanel(answer(authoredTranslation, question.correctId))).toContain('ترجمة عربية مضافة')
})

it('shows reviewed authored German and Arabic only after answering and hides a pending example', () => {
  const [raw] = rawPilot
  const fact = [...catalog.facts.values()].find(fact => fact.entry.id === raw.id && fact.mode === 'article')!
  const [question] = makeQuiz({ ...catalog, facts: new Map([[fact.id, fact]]) }, () => .5)
  const authored = {
    entryId: raw.id, level: 'A1', origin: 'authored', verificationStatus: 'reviewed',
    german: 'Beispielsatz für den Test.', arabic: 'جملة للاختبار.',
  }
  const [reviewed] = readVerifiedPilot([raw], [authored])
  const [pending] = readVerifiedPilot([raw], [{ ...authored, verificationStatus: 'needs_manual_review' }])
  const attempt = newAttempt([{ ...question, entry: reviewed }], 'random', 'A1')
  expect(renderPanel(attempt)).not.toContain(authored.german)
  expect(renderPanel(attempt)).not.toContain(authored.arabic)
  const answered = renderPanel(answer(attempt, question.correctId))
  expect(answered).toContain('مثال مؤلَّف')
  expect(answered).toContain('<p lang="de" dir="ltr">' + authored.german + '</p>')
  expect(answered).toContain('<p lang="ar" dir="rtl">' + authored.arabic + '</p>')
  expect(pending.incompleteExampleLevels).toContain('A1')
  const unapproved = newAttempt([{ ...question, entry: pending }], 'random', 'A1')
  expect(renderPanel(answer(unapproved, question.correctId))).not.toContain('جملة مثال')
})

it('scores an undersized round by the actual number of questions and explains the cap', () => {
  const questions = makeQuiz(catalog, () => .5).slice(0, 3)
  let attempt = newAttempt(questions, 'random', 'A2', 50)
  expect(renderPanel(attempt)).toContain('طلبت ٥٠ سؤالًا. الحد المتاح من المجموعة المختارة لهذا المستوى دون تكرار هو ٣.')
  for (const [index, question] of questions.entries()) {
    const choice = index === 0 ? question.choices.find(c => c.id !== question.correctId)!.id : question.correctId
    attempt = nextQuestion(answer(attempt, choice))
  }
  const results = renderToStaticMarkup(<Results attempt={attempt} start={() => {}} retry={() => {}} />)
  expect(results).toContain('<dt>مجموع الأسئلة</dt><dd>٣</dd>')
  expect(results).toContain('<dt>إجابات صحيحة</dt><dd class="correct-text">٢</dd>')
  expect(results).toContain('<dt>إجابات خاطئة</dt><dd class="wrong-text">١</dd>')
  expect(results).toContain(new Intl.NumberFormat('ar-u-nu-arab', { style: 'percent' }).format(2 / 3))
})

it('renders the prompt, choices and locked feedback in their proper directions in both translation modes', () => {
  for (const mode of ['de-ar', 'ar-de'] as const) {
    const { markup, question } = renderQuestion(mode)
    const direction = mode === 'de-ar' ? 'lang="de" dir="ltr"' : 'lang="ar" dir="rtl"'
    expect(markup).toContain(direction + '>' + question.prompt.text)
    for (const choice of question.choices) {
      const direction = choice.lang === 'de' ? 'ltr' : 'rtl'
      expect(markup).toContain('lang="' + choice.lang + '" dir="' + direction + '">' + choice.text)
    }
    expect(markup).toContain('إجابة غير صحيحة')
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(4)
    expect(markup.match(/class="choice correct"/g)).toHaveLength(1)
  }
  const { markup, question } = renderQuestion('article')
  expect(markup).toContain('lang="de" dir="ltr">' + question.entry.article + ' ' + question.entry.german)
  expect(markup).toContain('lang="ar" dir="rtl">' + question.entry.arabic_translations.join(' / '))
  expect(markup.match(/aria-disabled="true"/g)).toHaveLength(3)
})
