import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const [folder, scope = 'build'] = process.argv.slice(2)
if (!folder || !['index', 'build'].includes(scope)) throw new Error('Supply the private audit folder and index or build.')
const read = name => JSON.parse(readFileSync(join(folder, name), 'utf8'))
const pack = read('german-quiz-study-private.json')
const archive = read('page-inventory-private.json')
const normalized = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim()
const excerpt = text => text.split('\n').map(normalized).filter(line => line.length >= 50).slice(0, 4)
const privateStrings = new Set([
  ...pack.questions.flatMap(item => [item.german, item.arabic, item.explanation, item.passageArabic, item.model, item.prompt]),
  ...pack.lessons.flatMap(item => [item.explanation]),
  ...pack.chapters.flatMap(item => item.objectives),
  ...Object.values(archive).flatMap(pages => pages.flatMap(page => excerpt(page.text))),
].filter(text => typeof text === 'string' && text.length >= 28).map(normalized))

const reserved = /(?:^|\/)(?:study-private|source-pdfs|data|reports|backups)(?:\/|$)|\.pdf$|(?:-private[^/]*|reviewed-[^/]*)\.json$/iu
const section = scope === 'index' ? '' : resolve('dist')
const files = section
  ? readdirSync(section, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => relative(section, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  : execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)

for (const file of files) {
  if (reserved.test(file)) throw new Error('Restricted file path: ' + file)
  const bytes = section ? readFileSync(join(section, file)) : execFileSync('git', ['show', ':' + file])
  if (bytes.subarray(0, 5).toString() === '%PDF-') throw new Error('PDF signature in ' + file)
  if (!/\.(?:css|js|json|html|ts|tsx|mjs|md|yml|py|webmanifest|svg)$/iu.test(file)) continue
  const value = normalized(bytes.toString('utf8'))
  if ([...privateStrings].some(phrase => value.includes(phrase) || value.includes(JSON.stringify(phrase).slice(1, -1)))) {
    throw new Error('Private study text found in ' + file)
  }
}
console.log(JSON.stringify({ scope, files: files.length, privatePhrasesChecked: privateStrings.size }))
