import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readDistractorGroups(root, required = false) {
  const file = join(root, 'data', 'distractor-groups.json')
  if (!required && !existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8'))
}
