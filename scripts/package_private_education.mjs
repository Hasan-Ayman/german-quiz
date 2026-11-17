import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEducationPackage, serializeEducationPackage, validateEducationPackage } from '../src/education-package.ts'

const [vocabularyFile, studyFile, destination] = process.argv.slice(2)
if (!vocabularyFile || !studyFile || !destination) {
  throw new Error('Pass the existing vocabulary JSON, study JSON, and an output path outside the repository.')
}
const output = resolve(destination)
const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const withinRepository = relative(repository, output)
if (!withinRepository || (!isAbsolute(withinRepository) && !withinRepository.startsWith('..' + sep))) {
  throw new Error('Save your private education package outside the repository.')
}
const [vocabulary, study] = await Promise.all([vocabularyFile, studyFile].map(async filename =>
  JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/u, ''))))
const content = createEducationPackage(vocabulary, study)
validateEducationPackage(content)

const json = serializeEducationPackage(content)
await writeFile(output, json, { flag: 'wx' })
console.log(JSON.stringify({ path: output, bytes: Buffer.byteLength(json), entries: vocabulary.entries.length,
  sourceRows: vocabulary.sourceRows?.length ?? 0, chapters: study.chapters.length, lessons: study.lessons.length,
  activities: study.questions.length }))
