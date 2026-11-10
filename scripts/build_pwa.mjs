import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const source = new URL('../pwa/', import.meta.url)
const index = new URL('index.html', dist)
const staticFiles = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'apple-touch-icon.png']
for (const name of staticFiles) copyFileSync(new URL(name, source), new URL(name, dist))

const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; " +
  "manifest-src 'self'; worker-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"
const head = [
  '<meta http-equiv="Content-Security-Policy" content="' + policy + '">',
  '<link rel="manifest" href="/german-quiz/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="/german-quiz/apple-touch-icon.png">',
].join('\n    ')
const html = readFileSync(index, 'utf8').replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n    ' + head)
writeFileSync(index, html)

const shellFiles = ['index.html', ...staticFiles, ...readdirSync(new URL('assets/', dist)).sort().map(name => 'assets/' + name)]
const template = readFileSync(new URL('service-worker.js', source), 'utf8')
const hash = createHash('sha256').update(template)
for (const name of shellFiles) hash.update(name).update(readFileSync(new URL(name, dist)))
const version = hash.digest('hex').slice(0, 16)
const worker = 'const cachePrefix = "german-quiz-shell:"\n' +
  'const shellCache = cachePrefix + ' + JSON.stringify(version) + '\n' +
  'const shellFiles = ' + JSON.stringify(shellFiles) + '\n\n' + template
writeFileSync(new URL('sw.js', dist), worker)
