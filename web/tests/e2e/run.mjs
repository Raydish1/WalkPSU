// End-to-end checks in headless Microsoft Edge at phone size, against the mock Supabase (tests/mock/supabase.mjs).
// Starts the mock, builds the app for production against it, and serves that build, so nothing else needs to run:
//
//   npm run test:e2e                      # uses installed Edge (Windows/macOS)
//   E2E_BROWSER_CHANNEL=chrome npm run test:e2e
//
// Why headless Edge: MapLibre renders only on requestAnimationFrame, which embedded/hidden browser panes often stop
// firing. Software WebGL (SwiftShader) is enough to render and query the map.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { HUNT_SPOT, MOCK_PORT, OLD_MAIN_LAWN, startMockSupabase } from '../mock/supabase.mjs'

const WEB_DIR = fileURLToPath(new URL('../../', import.meta.url))
const PORT = Number(process.env.E2E_PORT ?? 5199)
const BASE = `http://localhost:${PORT}`
const MOCK = `http://localhost:${MOCK_PORT}`
const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url))
const M_PER_DEG_LAT = 111_195
mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ' :: ' + JSON.stringify(detail)}`)
  if (!ok) failures++
}

const OUT_DIR = 'node_modules/.cache/e2e-dist'
const VITE = ['node_modules/vite/bin/vite.js']
// Env vars override web/.env, so a developer's real Supabase/Auth0 settings never reach the test build.
const TEST_ENV = { ...process.env, VITE_SUPABASE_URL: MOCK, VITE_SUPABASE_ANON_KEY: 'mock', VITE_AUTH0_DOMAIN: '', VITE_AUTH0_CLIENT_ID: '', VITE_E2E: '1' }

/** Tests run against a production build (what Vercel serves), so prod-only breakage like the MapLibre worker shows up. */
async function buildAndServe() {
  const build = spawn(process.execPath, [...VITE, 'build', '--outDir', OUT_DIR, '--emptyOutDir'], { cwd: WEB_DIR, env: TEST_ENV, stdio: 'ignore' })
  const code = await new Promise((resolve) => build.on('exit', resolve))
  if (code !== 0) throw new Error(`vite build failed (${code})`)

  const server = spawn(process.execPath, [...VITE, 'preview', '--outDir', OUT_DIR, '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, env: TEST_ENV, stdio: 'ignore' })
  let exited = null
  server.on('exit', (c) => (exited = c))
  const deadline = Date.now() + 30_000
  for (;;) {
    if (exited !== null) throw new Error(`vite preview exited with ${exited}`)
    if (Date.now() > deadline) {
      server.kill()
      throw new Error('vite preview did not start in 30 s')
    }
    try {
      if ((await fetch(BASE)).ok) return server
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

async function newPhone(browser, position) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: position.lat, longitude: position.lng },
    permissions: ['geolocation'],
  })
  const page = await context.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  // Console only says "Failed to load resource"; record the URL from the response instead.
  page.on('console', (m) => m.type() === 'error' && !/WebSocket|realtime|Failed to load resource/i.test(m.text()) && page.errors.push(m.text()))
  page.on('response', (r) => r.status() >= 400 && page.errors.push(`${r.status()} ${r.request().method()} ${r.url()}`))
  await page.goto(BASE)
  await page.fill('form input.input', 'Rayhan')
  await page.click('text=Start playing')
  return page
}

const mapReady = (page) =>
  page.waitForFunction(() => window.__walkpsuMap?.isStyleLoaded() && window.__walkpsuMap.queryRenderedFeatures({ layers: ['buildings-base'] }).length > 0, null, { timeout: 30_000 })

async function tapFeature(page, layer, id) {
  const pt = await page.evaluate(([layer, id]) => {
    const map = window.__walkpsuMap
    const f = map.queryRenderedFeatures({ layers: [layer] }).find((x) => x.properties.id === id)
    if (!f) return null
    const box = map.getContainer().getBoundingClientRect()
    const p = map.project(f.geometry.coordinates)
    return { x: box.left + p.x, y: box.top + p.y }
  }, [layer, id])
  if (!pt) throw new Error(`no rendered ${layer} feature ${id}`)
  await page.touchscreen.tap(pt.x, pt.y)
}

async function mapScenario(browser) {
  console.log('\n# Map (player 20 m from the Old Main lawn drop)')
  const page = await newPhone(browser, { lat: OLD_MAIN_LAWN.lat + 20 / M_PER_DEG_LAT, lng: OLD_MAIN_LAWN.lng })
  await mapReady(page)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: SHOTS + 'map.png' })

  const s = await page.evaluate(() => {
    const map = window.__walkpsuMap
    const q = (layers) => map.queryRenderedFeatures({ layers })
    return {
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      basemapBuilding: map.getLayoutProperty('building', 'visibility'),
      lawns: !!map.getLayer('lawns'),
      controls: [...document.querySelectorAll('.maplibregl-ctrl')].map((c) => c.className),
      active: [...new Set(q(['buildings-active']).map((f) => f.properties.num))],
      heights: q(['buildings-base']).map((f) => f.properties.height),
      inRange: q(['claim-circles-in']).length,
      // Player sprites are DOM markers (they breathe, blink and hop), so count them in the DOM, not the map's layers.
      me: document.querySelectorAll('.sprite.is-me').length,
    }
  })
  check('opens on the player at zoom 17, pitch 45, bearing -17', Math.round(s.zoom) === 17 && s.pitch === 45 && Math.round(s.bearing) === -17, s)
  check('basemap buildings hidden, lawns layer added', s.basemapBuilding === 'none' && s.lawns, s)
  check('only the compact attribution control', s.controls.length === 1 && /attrib/.test(s.controls[0]) && !/compact-show/.test(s.controls[0]), s.controls)
  check('building hosting the Shake-Off drop is highlighted', JSON.stringify(s.active) === '["0005000"]', s.active)
  check('extrusions are 10-15 m', s.heights.length > 0 && Math.min(...s.heights) >= 10 && Math.max(...s.heights) <= 15, [Math.min(...s.heights), Math.max(...s.heights)])
  check('in-range claim circle and my sprite render', s.inRange > 0 && s.me === 1, s)

  await tapFeature(page, 'drop-points', 'game-drop')
  await page.waitForSelector('.map-card')
  check('Shake-Off drop card offers the lobby', /Open the lobby/.test(await page.textContent('.map-card')))
  await page.touchscreen.tap(40, 300)
  await page.waitForTimeout(300)

  await tapFeature(page, 'drop-points', 'center-drop')
  await page.waitForSelector('.map-card button.primary:not([disabled])')
  await page.screenshot({ path: SHOTS + 'card.png' })
  await page.click('.map-card button.primary')
  await page.waitForFunction(() => /Claimed!/.test(document.querySelector('.map-card')?.textContent ?? '') || !document.querySelector('.map-card'))
  await page.waitForFunction(() => !window.__walkpsuMap.queryRenderedFeatures({ layers: ['drop-points'] }).some((f) => f.properties.id === 'center-drop'), null, { timeout: 10_000 })
  const state = await (await fetch(`${MOCK}/__state`)).json()
  check('Claim in range succeeds and the drop leaves the map', state.claims.some((c) => c.drop_id === 'center-drop'), state.claims)

  const fps = await page.evaluate(async () => {
    const map = window.__walkpsuMap
    let frames = 0
    let running = true
    const tick = () => {
      frames++
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    map.easeTo({ bearing: map.getBearing() + 120, zoom: map.getZoom() - 1, duration: 3000 })
    await new Promise((r) => setTimeout(r, 3000))
    running = false
    return frames / 3
  })
  console.log(`INFO ${fps.toFixed(0)} fps during a 3 s camera move (software WebGL; a phone GPU differs)`)

  const bounds = await page.evaluate(() => {
    const map = window.__walkpsuMap
    const [[w, s], [e, n]] = map.getMaxBounds().toArray()
    map.jumpTo({ center: [-77.9609, 40.7045], zoom: 16 })
    const c = map.getCenter()
    map.jumpTo({ zoom: 5 })
    return { inside: c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n, zoom: map.getZoom() }
  })
  check('cannot pan to Ag Progress Days or zoom out past campus', bounds.inside && bounds.zoom > 11.5, bounds)
  await page.click('.map-recenter')
  await page.waitForTimeout(1300)
  check('recenter returns to the player at zoom 17', Math.round(await page.evaluate(() => window.__walkpsuMap.getZoom())) === 17)

  await page.click('a[href="/leaderboard"]')
  await page.waitForSelector('.leaderboard-row')
  check('leaderboard credits the claim', /Rayhan \(you\)\s*15/.test((await page.textContent('.leaderboard')).replace(/\s+/g, ' ')), await page.textContent('.leaderboard'))

  await page.goto(`${BASE}/admin`)
  await mapReady(page)
  const oldMain = await page.evaluate(() => {
    const map = window.__walkpsuMap
    map.jumpTo({ center: [-77.862804, 40.796443], zoom: 17 })
    const box = map.getContainer().getBoundingClientRect()
    const p = map.project([-77.862804, 40.796443])
    return { x: box.left + p.x, y: box.top + p.y }
  })
  await page.waitForTimeout(800)
  await page.touchscreen.tap(oldMain.x, oldMain.y)
  await page.waitForTimeout(400)
  const admin = await page.evaluate(() => ({
    where: document.querySelector('main section > p.muted')?.textContent,
    title: document.querySelector('form input.input')?.value,
    target: window.__walkpsuMap.queryRenderedFeatures({ layers: ['admin-target'] }).length,
  }))
  check('admin tap-to-place resolves the building', admin.where === 'At Old Main' && admin.title === 'Old Main' && admin.target === 1, admin)
  check('no console errors', page.errors.length === 0, page.errors)
  await page.context().close()
}

// 1x1 PNG: any real image will do, since the mock referee accepts every photo.
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function photoHuntScenario(browser) {
  console.log('\n# Photo hunt (player 50 m from the hidden spot, inside the 60 m claim radius)')
  // Not exactly on the spot: the player's sprite would sit on top of the revealed pin and swallow the tap.
  const page = await newPhone(browser, { lat: HUNT_SPOT.lat, lng: HUNT_SPOT.lng + 50 / (M_PER_DEG_LAT * Math.cos((HUNT_SPOT.lat * Math.PI) / 180)) })
  // vite preview doesn't run web/api, and the real referee is Gemini, so the mock stands in for /api/verify-photo.
  await page.route('**/api/verify-photo', async (route) => {
    const res = await fetch(`${MOCK}/__verify-photo`, { method: 'POST', headers: route.request().headers(), body: route.request().postData() })
    await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
  })
  await mapReady(page)
  await page.waitForTimeout(1500)

  const rendered = () =>
    page.evaluate(() => {
      const q = (layers) => window.__walkpsuMap.queryRenderedFeatures({ layers }).map((f) => f.properties.id)
      return { areas: q(['hunt-areas']), pins: q(['drop-points']) }
    })
  let s = await rendered()
  check('hidden hunt shows a search circle and no pin', s.areas.includes('hunt-drop') && !s.pins.includes('hunt-drop'), s)

  const hunt = (await (await fetch(`${MOCK}/__state`)).json()).drops.find((d) => d.id === 'hunt-drop')
  const center = await page.evaluate(([lng, lat]) => {
    const map = window.__walkpsuMap
    const box = map.getContainer().getBoundingClientRect()
    const p = map.project([lng, lat])
    return { x: box.left + p.x, y: box.top + p.y }
  }, [hunt.lng, hunt.lat])
  await page.touchscreen.tap(center.x, center.y)
  await page.waitForSelector('.map-card .hunt-twist')
  await page.waitForSelector('.map-card label.button:not([aria-disabled])')
  check('card shows the twist and a camera button', /with a thumbs up/.test(await page.textContent('.map-card')) && /Take the photo/.test(await page.textContent('.map-card')))
  await page.screenshot({ path: SHOTS + 'photo-hunt-card.png' })

  await page.setInputFiles('.map-card input[type=file]', { name: 'spot.png', mimeType: 'image/png', buffer: PHOTO })
  await page.waitForSelector('.found-overlay', { timeout: 10_000 })
  const overlay = (await page.textContent('.found-overlay')).replace(/\s+/g, ' ')
  check('celebration shows the points and that the pin is revealed', /Found it!.*\+20 points.*First to find it/.test(overlay), overlay)
  await page.screenshot({ path: SHOTS + 'photo-hunt-celebration.png' })
  await page.click('.found-overlay .button')
  await page.waitForFunction(() => window.__walkpsuMap.queryRenderedFeatures({ layers: ['drop-points'] }).some((f) => f.properties.id === 'hunt-drop'), null, { timeout: 10_000 })
  s = await rendered()
  check('after the first find, the red pin replaces the search circle', s.pins.includes('hunt-drop') && !s.areas.includes('hunt-drop'), s)
  const state = await (await fetch(`${MOCK}/__state`)).json()
  check('the claim earned the full 20 points', state.claims.some((c) => c.drop_id === 'hunt-drop' && c.points === 20), state.claims)
  await page.screenshot({ path: SHOTS + 'photo-hunt-found.png' })

  await tapFeature(page, 'drop-points', 'hunt-drop')
  await page.waitForFunction(() => /Closes in [67]:\d\d/.test(document.querySelector('.map-card')?.textContent ?? ''), null, { timeout: 5_000 })
  check('revealed card counts down the 7-minute window', true)
  check('no console errors', page.errors.length === 0, page.errors)
  await page.context().close()
}

async function shakeOffScenario(browser) {
  console.log('\n# Shake-Off (3 bot players already in the lobby; joining makes 4)')
  const page = await newPhone(browser, { lat: OLD_MAIN_LAWN.lat, lng: OLD_MAIN_LAWN.lng })
  await page.waitForSelector('.bottom-nav')
  // Behave like Android Chrome: no permission prompt, a live sensor stream.
  await page.evaluate(() => Object.defineProperty(DeviceMotionEvent, 'requestPermission', { value: undefined, configurable: true }))
  await page.evaluate(() => {
    window.history.pushState({}, '', '/game/game-drop')
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.__motion = (x) => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x, y: 0, z: 0 }, accelerationIncludingGravity: { x, y: 9.81, z: 0 }, interval: 16 }))
    window.__idle = setInterval(() => window.__motion(0.3), 100)
  })
  await page.click('text=Join the Shake-Off')
  await page.waitForSelector('.lobby-sides', { timeout: 10_000 })
  check('countdown lobby shows both sides with my name marked', /Rayhan \(you\)/.test(await page.textContent('.lobby-sides')))
  await page.waitForSelector('text=SHAKE!', { timeout: 15_000 })
  const shaken = await page.evaluate(async () => {
    let i = 0
    while (document.body.innerText.includes('SHAKE!')) {
      window.__motion(i++ % 2 ? 22 : -22)
      await new Promise((r) => setTimeout(r, 170))
    }
    clearInterval(window.__idle)
    return i
  })
  await page.waitForSelector('.game-winners', { timeout: 15_000 })
  await page.screenshot({ path: SHOTS + 'shake-off-result.png' })
  const result = (await page.textContent('.game-screen')).replace(/\s+/g, ' ')
  const state = await (await fetch(`${MOCK}/__state`)).json()
  const mine = state.gamePlayers.find((gp) => !gp.player_id.startsWith('bot'))
  check(`shakes counted and stored under the cap (${mine?.shakes} of ${shaken} jolts, cap 120)`, mine?.shakes > 40 && mine.shakes <= 120, mine)
  check('winner screen names the winners and points', /Rayhan & Bot \w+ win!\s*\+30 points each/.test(result), result)
  check('MVP called out', /MVP: Rayhan \(you\)/.test(result), result)
  check('no console errors', page.errors.length === 0, page.errors)
  await page.context().close()
}

const mock = await startMockSupabase()
const server = await buildAndServe()
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  await mapScenario(browser)
  await photoHuntScenario(browser)
  await shakeOffScenario(browser)
} catch (e) {
  failures++
  console.log(`FAIL scenario crashed :: ${e.message}`)
} finally {
  await browser.close()
  server.kill()
  mock.close()
}
console.log(failures ? `\n${failures} check(s) failed (screenshots in tests/e2e/screenshots/)` : '\nAll e2e checks passed (screenshots in tests/e2e/screenshots/)')
process.exit(failures ? 1 : 0)
