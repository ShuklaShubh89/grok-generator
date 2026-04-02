import { createS3PresignedUrl } from "../src/lib/s3Presign";

function getS3Config() {
  const bucket = process.env.S3_BUCKET_NAME ?? "grk-outputs";
  const region = process.env.S3_REGION ?? "ap-south-1";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const sessionToken = process.env.S3_SESSION_TOKEN;
  const objectPrefix = process.env.S3_OBJECT_PREFIX ?? "grok-video-edits";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3 credentials");
  }
  return { bucket, region, accessKeyId, secretAccessKey, sessionToken, objectPrefix };
}

function isAllowedKey(key: string, objectPrefix?: string): boolean {
  if (!objectPrefix) return true;
  const normalizedPrefix = objectPrefix.replace(/^\/+|\/+$/g, "");
  return key === normalizedPrefix || key.startsWith(`${normalizedPrefix}/`);
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response("Missing key", { status: 400 });
    }

    const config = getS3Config();
    if (!isAllowedKey(key, config.objectPrefix)) {
      return new Response("Bad request", { status: 400 });
    }

    try {
      const signedUrl = await createS3PresignedUrl({
        method: request.method === "HEAD" ? "HEAD" : "GET",
        bucket: config.bucket,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
        key,
        expiresSeconds: 60,
      });

      const upstream = await fetch(signedUrl, { method: request.method });
      if (!upstream.ok) {
        return new Response("Upstream error", { status: upstream.status });
      }

      const headers = new Headers();
      const contentType = upstream.headers.get("content-type");
      if (contentType) headers.set("Content-Type", contentType);
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) headers.set("Content-Length", contentLength);
      const etag = upstream.headers.get("etag");
      if (etag) headers.set("ETag", etag);
      const acceptRanges = upstream.headers.get("accept-ranges");
      if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
      headers.set("Cache-Control", "private, max-age=60");

      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }

      const body = upstream.body ?? new ReadableStream();
      return new Response(body, {
        status: 200,
        headers,
      });
    } catch {
      return new Response("Proxy error", { status: 502 });
    }
  },
};
