// Tries the photo-hunt referee on two local photos, with no database involved.
// Usage (from web/): npm run test-gemini -- <reference photo> <player photo> ["twist"]
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { askGemini } from '../api/verify-photo.ts'

const [referencePath, playerPath, twist] = process.argv.slice(2)
if (!referencePath || !playerPath) {
  console.error('Usage: npm run test-gemini -- <reference photo> <player photo> ["twist"]')
  process.exit(1)
}

process.loadEnvFile('.env')

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic' }
const image = (path: string) => ({ mimeType: MIME[extname(path).toLowerCase()] ?? 'image/jpeg', data: readFileSync(path).toString('base64') })

const verdict = await askGemini(image(referencePath), image(playerPath), twist ?? null)
const match = verdict.same_place && (!twist || verdict.twist_done) && !verdict.photo_of_screen_or_print
console.log(verdict)
console.log(match ? '✅ MATCH: the player would get the points' : '❌ NO MATCH')
