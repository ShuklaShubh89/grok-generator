const textEncoder = new TextEncoder();

export interface S3PresignConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  objectPrefix?: string;
  uploadExpiresSeconds?: number;
  downloadExpiresSeconds?: number;
}

export interface S3PresignResult {
  key: string;
  uploadUrl: string;
  downloadUrl: string;
  uploadHeaders: Record<string, string>;
  uploadExpiresSeconds: number;
  downloadExpiresSeconds: number;
}

const DEFAULT_UPLOAD_EXPIRES_SECONDS = 900;
const DEFAULT_DOWNLOAD_EXPIRES_SECONDS = 21_600;

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalizePath(key: string): string {
  return `/${key.split("/").map((segment) => encodeRfc3986(segment)).join("/")}`;
}

function buildCanonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function normalizePrefix(prefix?: string): string {
  if (!prefix) return "";
  return prefix.replace(/^\/+|\/+$/g, "");
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "video.mp4";
  const safe = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "");
  return safe || "video.mp4";
}

function createObjectKey(fileName: string, objectPrefix?: string): string {
  const prefix = normalizePrefix(objectPrefix);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = sanitizeFileName(fileName);
  const random = globalThis.crypto.randomUUID();
  const key = `${timestamp}-${random}-${safeName}`;
  return prefix ? `${prefix}/${key}` : key;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacRaw(key: Uint8Array, data: string): Promise<Uint8Array> {
  const rawKey = new Uint8Array(key);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    rawKey.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(data));
  return new Uint8Array(signature);
}

async function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string): Promise<Uint8Array> {
  const kDate = await hmacRaw(textEncoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, "s3");
  return hmacRaw(kService, "aws4_request");
}

function buildQueryString(
  baseParams: Record<string, string>,
  sessionToken?: string
): string {
  const params = sessionToken
    ? { ...baseParams, "X-Amz-Security-Token": sessionToken }
    : baseParams;
  return buildCanonicalQuery(params);
}

async function presignS3Url(params: {
  method: "GET" | "PUT" | "HEAD";
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  key: string;
  expiresSeconds: number;
  contentType?: string;
}): Promise<string> {
  const host = `${params.bucket}.s3.${params.region}.amazonaws.com`;
  const now = new Date();
  const { amzDate, dateStamp } = toAmzDate(now);
  const scope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const canonicalUri = canonicalizePath(params.key);

  const headers: Record<string, string> = { host };
  if (params.contentType) headers["content-type"] = params.contentType;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]!.trim()}\n`)
    .join("");

  const canonicalQuery = buildQueryString(
    {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${params.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(params.expiresSeconds),
      "X-Amz-SignedHeaders": signedHeaders,
    },
    params.sessionToken
  );

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(params.secretAccessKey, dateStamp, params.region);
  const signature = await hmacRaw(signingKey, stringToSign);
  const signatureHex = Array.from(signature)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signatureHex}`;
}

export async function createS3PresignedUrl({
  method,
  bucket,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  key,
  expiresSeconds = DEFAULT_DOWNLOAD_EXPIRES_SECONDS,
  contentType,
}: {
  method: "GET" | "PUT" | "HEAD";
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  key: string;
  expiresSeconds?: number;
  contentType?: string;
}): Promise<string> {
  return presignS3Url({
    method,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    key,
    expiresSeconds,
    contentType,
  });
}

export async function createS3PresignedUpload({
  bucket,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  objectPrefix,
  uploadExpiresSeconds = DEFAULT_UPLOAD_EXPIRES_SECONDS,
  downloadExpiresSeconds = DEFAULT_DOWNLOAD_EXPIRES_SECONDS,
  fileName,
  contentType,
}: S3PresignConfig & { fileName: string; contentType: string }): Promise<S3PresignResult> {
  const key = createObjectKey(fileName, objectPrefix);
  const uploadUrl = await presignS3Url({
    method: "PUT",
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    key,
    expiresSeconds: uploadExpiresSeconds,
    contentType,
  });

  const downloadUrl = await presignS3Url({
    method: "GET",
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    key,
    expiresSeconds: downloadExpiresSeconds,
  });

  return {
    key,
    uploadUrl,
    downloadUrl,
    uploadHeaders: { "Content-Type": contentType },
    uploadExpiresSeconds,
    downloadExpiresSeconds,
  };
}
