import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { datasetFormat, datasetVersion, serializePersonalDataset, validatePersonalDataset } from '../src/personal-data.ts'
import { addApprovedLocalExamples, readAutomaticallyValidated, readVerifiedPilot } from '../src/pilot.ts'
import { readDistractorGroups } from './read_distractor_groups.mjs'

const root = new URL('../data/', import.meta.url)
if (!process.argv[2]) throw new Error('Specify a destination in a local folder outside the repository or any cloud-synced folder.')
const requested = resolve(process.argv[2])
if (requested.startsWith('\\\\')) throw new Error('Choose a local destination instead of a network path.')
const repo = fileURLToPath(new URL('..', root))
const destination = realpathSync(dirname(requested))
const output = join(destination, basename(requested))
const protectedFolders = [repo, process.env.OneDrive, process.env.OneDriveCommercial, process.env.OneDriveConsumer,
  process.env.USERPROFILE && join(process.env.USERPROFILE, 'OneDrive')]
if (output.startsWith('\\\\') || protectedFolders.some(folder => {
  if (!folder) return false
  const path = relative(existsSync(folder) ? realpathSync(folder) : folder, destination)
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)
})) throw new Error('Choose a local destination outside the repository and OneDrive.')
const read = (name, optional = false) => {
  const path = new URL(name + '.json', root)
  if (optional && !existsSync(path)) return []
  return JSON.parse(readFileSync(path, 'utf8'))
}
const pilot = read('verified-pilot')
const local = read('phase3-local-quiz')
const automatic = read('phase3-local-automatic-quiz')
const reviewed = readVerifiedPilot(pilot, [...read('authored-examples'), ...read('phase3-local-authored')], local)
const input = [...reviewed, ...readAutomaticallyValidated(automatic)]
const approved = addApprovedLocalExamples(
  addApprovedLocalExamples(input, read('phase35-local-approved-examples', true)),
  read('phase35-local-auto-examples'),
)
const rawById = new Map([...pilot, ...local, ...automatic].map(row => [row.id, row]))
if (rawById.size !== input.length) throw new Error('Vocabulary IDs overlap between input datasets')
const automaticIds = new Set(automatic.map(row => row.id))
const entries = approved.map(entry => ({
  ...entry,
  vocabularyStatus: automaticIds.has(entry.id) ? 'automatically_validated' : 'reviewed',
  sources: rawById.get(entry.id).sources.map(source => ({
    id: source.id, level: source.level, sourcePdf: source.source_pdf,
    chapter: source.chapter_number, page: source.source_page, chapterTitle: source.chapter_title,
    verificationStatus: source.verification_status, approvalStatus: source.approval_status, reviewMethod: source.review_method,
  })),
}))
const distractorGroups = readDistractorGroups(repo, true)
const dataset = validatePersonalDataset({ format: datasetFormat, version: datasetVersion, entries, distractorGroups })
writeFileSync(output, serializePersonalDataset(dataset), { flag: 'wx' })
console.log('Wrote ' + dataset.entries.length + ' personal vocabulary entries to ' + output)
