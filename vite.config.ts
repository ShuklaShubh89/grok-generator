import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createS3PresignedUpload } from './src/lib/s3Presign'

// https://vite.dev/config/
// Proxy for imgen.x.ai and vidgen.x.ai when using `npm run dev` (vite).
const PROXY_ALLOWED = ['https://imgen.x.ai/', 'https://vidgen.x.ai/'];
function getS3Config() {
  const bucket = process.env.S3_BUCKET_NAME ?? 'grk-outputs';
  const region = process.env.S3_REGION ?? 'ap-south-1';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const sessionToken = process.env.S3_SESSION_TOKEN;
  const objectPrefix = process.env.S3_OBJECT_PREFIX ?? 'grok-video-edits';
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3 credentials');
  }
  return { bucket, region, accessKeyId, secretAccessKey, sessionToken, objectPrefix };
}

export default defineConfig({
  server: {
    proxy: {
      // Route xAI API calls through Vite dev server to avoid browser CORS preflight failures.
      '/v1': {
        target: 'https://api.x.ai',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'proxy-xai-media',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api/s3-presign')) {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.end('Method not allowed')
              return
            }

            const chunks: Buffer[] = []
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            }

            let payload: { fileName?: string; contentType?: string } = {}
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            } catch {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Invalid JSON body' }))
              return
            }

            if (!payload.fileName) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'fileName is required' }))
              return
            }

            try {
              const result = await createS3PresignedUpload({
                ...getS3Config(),
                fileName: payload.fileName,
                contentType: payload.contentType ?? 'video/mp4',
              })
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result))
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to create presigned URL' }))
            }
            return
          }

          if (req.url?.startsWith('/api/proxy-image?')) {
            const url = new URL(req.url, 'http://localhost').searchParams.get('url')
            if (!url || !PROXY_ALLOWED.some(origin => url.startsWith(origin))) {
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
