import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function verifyPublicBuild(directory) {
  const rootFiles = new Set(['index.html', 'manifest.webmanifest', 'sw.js',
    'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'])
  const files = readdirSync(directory, { withFileTypes: true })
  for (const entry of files) {
    if (entry.name === 'assets' && entry.isDirectory()) continue
    if (!entry.isFile() || !rootFiles.delete(entry.name)) throw new Error('Unexpected Pages file: ' + entry.name)
  }
  if (rootFiles.size) throw new Error('Pages shell is missing: ' + [...rootFiles].join(', '))
  const assets = readdirSync(join(directory, 'assets'), { withFileTypes: true })
  if (assets.length !== 3 || !['js', 'css', 'svg'].every(ext => assets.some(entry => entry.name.endsWith('.' + ext)))) {
    throw new Error('Unexpected app asset count or types')
  }
  for (const entry of assets) {
    if (!entry.isFile() || !/^(?:index-[\w-]+\.(?:js|css)|mark-[\w-]+\.svg)$/u.test(entry.name)) {
      throw new Error('Unexpected app asset: ' + entry.name)
    }
  }
  const html = readFileSync(join(directory, 'index.html'), 'utf8')
  const js = readFileSync(join(directory, 'assets', assets.find(entry => entry.name.endsWith('.js')).name), 'utf8')
  if (!html.includes("connect-src 'none'") || /virtual:verified-pilot|verified-pilot\.json|phase3-local|phase35-local|sourceMappingURL=|vocab-[0-9a-f]{24}/u.test(js + html)) {
    throw new Error('The Pages shell includes a private data marker or lacks its network policy')
  }
  return 7 + assets.length
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Verified ' + verifyPublicBuild(fileURLToPath(new URL('../dist/', import.meta.url))) + ' public app files.')
}
