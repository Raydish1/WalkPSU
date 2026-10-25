import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Serves api/<name>.ts on the dev server the way Vercel does in production, so `npm run dev` runs the whole app. */
function apiRoutes(): Plugin {
  return {
    name: 'api-routes',
    configureServer(server) {
      // Server-only secrets (no VITE_ prefix) aren't loaded by Vite by default.
      Object.assign(process.env, loadEnv(server.config.mode, server.config.root, ''))
      server.middlewares.use('/api', async (req, res, next) => {
        const name = req.url?.split('?')[0].replace(/^\//, '') ?? ''
        const file = join(server.config.root, 'api', `${name}.ts`)
        if (!/^[\w-]+$/.test(name) || !existsSync(file)) return next()
        try {
          const handler = (await server.ssrLoadModule(file))[req.method ?? 'GET'] as ((r: Request) => Promise<Response>) | undefined
          if (!handler) {
            res.statusCode = 405
            return res.end()
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, String(value))
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
          const response = await handler(
            new Request(new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost'), {
              method: req.method,
              headers,
              body: hasBody ? Buffer.concat(chunks) : undefined,
            }),
          )
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiRoutes()],
  // Pre-bundling moves MapLibre into .vite/deps, away from the worker file it loads next to itself.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
