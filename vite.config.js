import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Optional local-dev proxy: set LOCAL_SUPABASE_PROXY=1 to route /auth/v1 and /rest/v1
// to a self-hosted Supabase stack. Not used in production (Vercel talks to Supabase directly).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const local = env.LOCAL_SUPABASE_PROXY === '1'
  if (local) Object.assign(process.env, env) // expose server-only vars to /api handlers in dev
  return {
    plugins: [react(), tailwindcss(), local && devApi()].filter(Boolean),
    build: { chunkSizeWarningLimit: 1200 },
    server: local ? {
      proxy: {
        '/auth/v1': { target: 'http://127.0.0.1:9999', rewrite: p => p.replace(/^\/auth\/v1/, '') },
        '/rest/v1': { target: 'http://127.0.0.1:3000', rewrite: p => p.replace(/^\/rest\/v1/, '') },
      },
    } : undefined,
  }
})

// Serves /api/*.js (Vercel functions) during local development.
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        const name = req.url.split('?')[0].replace(/^\//, '')
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`)
          let body = ''
          for await (const chunk of req) body += chunk
          req.body = body ? JSON.parse(body) : {}
          res.status = c => { res.statusCode = c; return res }
          res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
          await mod.default(req, res)
        } catch (e) {
          res.statusCode = 500; res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}
