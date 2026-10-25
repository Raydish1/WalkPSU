// Runs every *.test.mjs in this folder in its own process; exits non-zero if any fail.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
let failed = 0
for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  console.log(`\n# ${file}`)
  const { status } = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', dir + file], { stdio: 'inherit' })
  if (status !== 0) failed++
}
console.log(failed ? `\n${failed} file(s) failed` : '\nAll SQL tests passed')
process.exit(failed ? 1 : 0)
