import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Proxy for imgen.x.ai when using `npm run dev` (vite). For production mirror run `npm run dev:vercel` (vercel dev).
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'proxy-imgen',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api/proxy-image?')) {
            const url = new URL(req.url, 'http://localhost').searchParams.get('url')
            if (!url || !url.startsWith('https://imgen.x.ai/')) {
              res.statusCode = 400
              res.end()
              return
            }
            try {
              const proxyRes = await fetch(url)
              res.statusCode = proxyRes.status
              proxyRes.headers.get('content-type') && res.setHeader('Content-Type', proxyRes.headers.get('content-type')!)
              const buf = await proxyRes.arrayBuffer()
              res.end(Buffer.from(buf))
            } catch (e) {
              res.statusCode = 502
              res.end()
            }
            return
          }
          next()
        })
      },
    },
  ],
})
