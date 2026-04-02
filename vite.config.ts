import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createS3PresignedUpload, createS3PresignedUrl } from './src/lib/s3Presign'

// https://vite.dev/config/
// Proxy for imgen.x.ai and vidgen.x.ai when using `npm run dev` (vite).
const PROXY_ALLOWED = ['https://imgen.x.ai/', 'https://vidgen.x.ai/'];

function getS3Config(env: Record<string, string | undefined>) {
  const bucket = env.S3_BUCKET_NAME ?? process.env.S3_BUCKET_NAME ?? 'grk-outputs';
  const region = env.S3_REGION ?? process.env.S3_REGION ?? 'ap-south-1';
  const accessKeyId = env.S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
  const sessionToken = env.S3_SESSION_TOKEN ?? process.env.S3_SESSION_TOKEN;
  const objectPrefix = env.S3_OBJECT_PREFIX ?? process.env.S3_OBJECT_PREFIX ?? 'grok-video-edits';
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3 credentials');
  }
  return { bucket, region, accessKeyId, secretAccessKey, sessionToken, objectPrefix };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = [
    '.ngrok-free.app',
    '.ngrok-free.dev',
    '.ngrok.app',
    '.trycloudflare.com',
  ];

  return {
    server: {
      allowedHosts,
      host: true,
      proxy: {
        // Route xAI API calls through Vite dev server to avoid browser CORS preflight failures.
        '/v1': {
          target: 'https://api.x.ai',
          changeOrigin: true,
          secure: true,
        },
      },
    },
    preview: {
      allowedHosts,
      host: true,
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
                  ...getS3Config(env),
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

            if (req.url?.startsWith('/api/video-source?')) {
              if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.statusCode = 405
                res.end('Method not allowed')
                return
              }

              const key = new URL(req.url, 'http://localhost').searchParams.get('key')
              if (!key) {
                res.statusCode = 400
                res.end('Missing key')
                return
              }

              const config = getS3Config(env)
              const normalizedPrefix = (config.objectPrefix ?? '').replace(/^\/+|\/+$/g, '')
              if (normalizedPrefix && !(key === normalizedPrefix || key.startsWith(`${normalizedPrefix}/`))) {
                res.statusCode = 400
                res.end('Bad request')
                return
              }

              try {
                const signedUrl = await createS3PresignedUrl({
                  method: req.method === 'HEAD' ? 'HEAD' : 'GET',
                  bucket: config.bucket,
                  region: config.region,
                  accessKeyId: config.accessKeyId,
                  secretAccessKey: config.secretAccessKey,
                  sessionToken: config.sessionToken,
                  key,
                  expiresSeconds: 60,
                })

                const proxyRes = await fetch(signedUrl, { method: req.method })
                if (!proxyRes.ok) {
                  res.statusCode = proxyRes.status
                  res.end('Upstream error')
                  return
                }

                const contentType = proxyRes.headers.get('content-type')
                if (contentType) res.setHeader('Content-Type', contentType)
                const contentLength = proxyRes.headers.get('content-length')
                if (contentLength) res.setHeader('Content-Length', contentLength)
                const etag = proxyRes.headers.get('etag')
                if (etag) res.setHeader('ETag', etag)
                const acceptRanges = proxyRes.headers.get('accept-ranges')
                if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges)
                res.setHeader('Cache-Control', 'private, max-age=60')

                if (req.method === 'HEAD') {
                  res.statusCode = 200
                  res.end()
                  return
                }

                const buf = await proxyRes.arrayBuffer()
                res.statusCode = 200
                res.end(Buffer.from(buf))
              } catch {
                res.statusCode = 502
                res.end('Proxy error')
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
  }
})
