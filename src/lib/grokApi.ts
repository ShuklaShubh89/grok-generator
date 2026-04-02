import { createXai } from "@ai-sdk/xai";
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
import { generateImage } from "ai";
import { experimental_generateVideo as generateVideo } from "ai";
import { trackModerationEvent, isModerationError } from "./moderationTracking";
import { syncPromptRewriteApiKey } from "./grokPromptRewrite";

/** Captured CDN URLs from the most recent API call. Reset before each generation. */
let capturedCdnUrls: string[] = [];
export interface XaiApiErrorTrace {
  url: string;
  method: string;
  status: number;
  body: string;
}

let lastXaiApiErrorTrace: XaiApiErrorTrace | null = null;

let userApiKey: string | null = null;

/** Set the API key from the UI input (overrides env). Pass null to clear. */
export function setGrokApiKey(key: string | null): void {
  userApiKey = key?.trim() || null;
  syncPromptRewriteApiKey(userApiKey);
}

export function clearLastXaiApiErrorTrace(): void {
  lastXaiApiErrorTrace = null;
}

export function getLastXaiApiErrorTrace(): XaiApiErrorTrace | null {
  return lastXaiApiErrorTrace;
}

function getApiKey(): string {
  if (!userApiKey) throw new Error("Grok API key is not set. Please log in.");
  return userApiKey;
}

const getBaseUrl = () =>
  import.meta.env.VITE_GROK_API_URL ?? "/v1";

const XAI_CDN_PREFIXES = ["https://imgen.x.ai/", "https://vidgen.x.ai/"];

function useProxy(url: string): boolean {
  return XAI_CDN_PREFIXES.some((p) => url.startsWith(p));
}

/** Custom fetch so requests to imgen.x.ai and vidgen.x.ai go via our proxy (avoids CORS). */
async function grokFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const method =
    init?.method ??
    (input instanceof Request ? input.method : "GET");

  if (useProxy(url)) {
    // Capture the original CDN URL before proxying
    capturedCdnUrls.push(url);
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    return fetch(proxyUrl, init);
  }

  const response = await fetch(input, init);

  const isXaiApiCall = url.startsWith("/v1/") || url.includes("api.x.ai/");
  if (isXaiApiCall && !response.ok) {
    try {
      const body = await response.clone().text();
      lastXaiApiErrorTrace = {
        url,
        method,
        status: response.status,
        body,
      };
    } catch {
      lastXaiApiErrorTrace = {
        url,
        method,
        status: response.status,
        body: "",
      };
    }
  }

  return response;
}

/** Custom download for generateVideo: fetches video URLs via our proxy to avoid CORS. */
async function proxyDownload(options: {
  url: URL;
  abortSignal?: AbortSignal;
}): Promise<{ data: Uint8Array; mediaType: string | undefined }> {
  const href = options.url.href;
  // Capture the original CDN URL before proxying
  if (useProxy(href)) {
    capturedCdnUrls.push(href);
  }
  const url = useProxy(href)
    ? `/api/proxy-image?url=${encodeURIComponent(href)}`
    : href;
  const res = await fetch(url, { signal: options.abortSignal });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return {
    data: new Uint8Array(buf),
    mediaType: res.headers.get("content-type") ?? undefined,
  };
}

function getXai() {
  return createXai({
    apiKey: getApiKey(),
    baseURL: getBaseUrl(),
    fetch: grokFetch,
  });
}

function dataUriToUint8Array(dataUri: string): Uint8Array {
  const base64 = dataUri.includes(",") ? dataUri.split(",")[1]! : dataUri;
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      return parsed.error ?? parsed.message ?? text;
    } catch {
      return text;
    }
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

/**
 * Compress an image to reduce file size and API costs.
 * Resizes to maxWidth if larger, and compresses to JPEG with specified quality.
 */
async function compressImage(
  dataUri: string,
  maxWidth = 1024,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      // Resize if too large
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG with compression
      const compressed = canvas.toDataURL("image/jpeg", quality);
      resolve(compressed);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUri;
  });
}

/** Extract a user-facing message from API errors (e.g. content moderation, rate limits, credits). */
function getErrorMessage(err: unknown): string {
  // SDK RetryError: "Failed after 3 attempts. Last error: ..." — use the last underlying error
  if (err && typeof err === "object" && "errors" in err && Array.isArray((err as { errors: unknown[] }).errors)) {
    const errors = (err as { errors: unknown[]; message?: string }).errors;
    const last = errors[errors.length - 1];
    if (last !== undefined) {
      const inner = getErrorMessage(last);
      if (inner && inner !== "Request failed") return inner;
    }
    const msg = (err as { message?: string }).message;
    if (typeof msg === "string" && msg.includes("Last error:")) {
      const after = msg.split("Last error:")[1]?.trim();
      if (after) return after;
    }
  }

  let body: string | null = null;
  if (
    err &&
    typeof err === "object" &&
    "responseBody" in err &&
    typeof (err as { responseBody?: string }).responseBody === "string"
  ) {
    body = (err as { responseBody: string }).responseBody;
  } else if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { error?: string | { message?: string } } }).data;
    if (data && typeof data.error === "string") return data.error;
    if (data?.error && typeof data.error === "object" && typeof data.error.message === "string")
      return data.error.message;
  } else if (err instanceof Error && err.message.trim().startsWith("{")) {
    body = err.message;
  }
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string | { message?: string }; code?: string };
      if (typeof parsed.error === "string") return parsed.error;
      if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string")
        return parsed.error.message;
    } catch {
      // not JSON
    }
  }
  if (err instanceof Error) {
    if ("cause" in err && err.cause !== undefined) {
      const fromCause = getErrorMessage(err.cause);
      if (fromCause && fromCause !== "Request failed") return fromCause;
    }
    return err.message;
  }
  return "Request failed";
}

export interface ImageEditResult {
  dataUrls: string[];
  sourceUrls: string[];
}

/**
 * Image edit: send image (data URI or URL) + prompt, returns image(s) as data URL(s) + CDN source URLs.
 * Uses Grok SDK (generateImage with grok-imagine-image or grok-imagine-image-pro).
 */
export async function imageEdit(
  prompt: string,
  imageDataUri: string,
  options?: { model?: "grok-imagine-image" | "grok-imagine-image-pro"; count?: number }
): Promise<ImageEditResult> {
  const modelName = options?.model ?? "grok-imagine-image";
  const imageCount = options?.count ?? 1;

  try {
    // Clear captured URLs before generation
    capturedCdnUrls = [];

    // Compress image before sending to API to reduce costs
    const compressed = await compressImage(imageDataUri, 1024, 0.85);

    const imageInput = compressed.startsWith("http")
      ? new Uint8Array(await (await fetch(compressed)).arrayBuffer())
      : dataUriToUint8Array(compressed);

    const { images } = await generateImage({
      model: getXai().image(modelName),
      prompt: {
        text: prompt,
        images: [imageInput],
      },
      maxImagesPerCall: 10,
      n: imageCount,
    });

    if (!images || images.length === 0) throw new Error("No images in response");

    // Track successful generation
    trackModerationEvent({
      type: 'image',
      prompt,
      inputImage: imageDataUri,
      moderated: false,
      model: modelName,
      metadata: { count: imageCount },
    });

    const dataUrls = images.map((img) => `data:${img.mediaType};base64,${img.base64}`);
    const sourceUrls = [...capturedCdnUrls];

    return { dataUrls, sourceUrls };
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    const moderated = isModerationError(errorMessage);

    // Track moderation event
    trackModerationEvent({
      type: 'image',
      prompt,
      inputImage: imageDataUri,
      moderated,
      errorMessage,
      model: modelName,
      metadata: { count: imageCount },
    });

    throw new Error(errorMessage);
  }
}

export interface VideoResult {
  dataUrl: string;
  sourceUrl: string | null;
}

async function runVideoJob(
  endpoint: "/videos/edits" | "/videos/extensions",
  body: Record<string, unknown>,
  options?: { pollTimeoutMs?: number; pollIntervalMs?: number }
): Promise<VideoResult> {
  const baseURL = getBaseUrl();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`,
  };

  const createResponse = await fetch(`${baseURL}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!createResponse.ok) {
    throw new Error(await readApiError(createResponse));
  }

  const createJson = (await createResponse.json()) as { request_id?: string };
  const requestId = createJson.request_id;
  if (!requestId) throw new Error("No request_id returned from xAI API.");

  const pollTimeoutMs = options?.pollTimeoutMs ?? 900_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 5_000;
  const startTime = Date.now();
  let statusResponse: { status?: string; video?: { url?: string; duration?: number } } | null = null;

  while (true) {
    if (Date.now() - startTime > pollTimeoutMs) {
      throw new Error(`Video job timed out after ${pollTimeoutMs}ms`);
    }

    await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs));

    const statusResponseRaw = await fetch(`${baseURL}/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });
    if (!statusResponseRaw.ok) {
      throw new Error(await readApiError(statusResponseRaw));
    }

    statusResponse = (await statusResponseRaw.json()) as { status?: string; video?: { url?: string; duration?: number } };

    if (statusResponse.status === "expired") {
      throw new Error("Video request expired.");
    }

    if (statusResponse.status === "failed") {
      throw new Error("Video request failed.");
    }

    if (statusResponse.status === "done" || (statusResponse.status == null && statusResponse.video?.url)) {
      break;
    }
  }

  const videoUrl = statusResponse?.video?.url;
  if (!videoUrl) {
    throw new Error("Video request completed but no video URL was returned.");
  }

  const downloaded = await proxyDownload({ url: new URL(videoUrl) });
  const dataUrl = `data:${downloaded.mediaType ?? "video/mp4"};base64,${convertUint8ArrayToBase64(downloaded.data)}`;
  const sourceUrl = capturedCdnUrls.length > 0 ? capturedCdnUrls[capturedCdnUrls.length - 1] : videoUrl;

  return { dataUrl, sourceUrl };
}

/**
 * Image-to-video: send image (data URI) + prompt, returns video as data URL + CDN source URL.
 * Uses Grok SDK (experimental_generateVideo with grok-imagine-video). Polling is handled by the SDK.
 */
export async function imageToVideo(
  prompt: string,
  imageDataUri: string,
  options?: { duration?: number; aspectRatio?: string; resolution?: string }
): Promise<VideoResult> {
  try {
    clearLastXaiApiErrorTrace();
    // Clear captured URLs before generation
    capturedCdnUrls = [];

    // Compress image before sending to API to reduce costs
    const compressed = await compressImage(imageDataUri, 1024, 0.85);

    const imageInput = compressed.startsWith("http")
      ? compressed
      : dataUriToUint8Array(compressed);

    // Map resolution options to actual dimensions
    // Supported resolutions: 480p (854x480) and 720p (1280x720)
    let resolutionDimensions: `${number}x${number}`;
    switch (options?.resolution) {
      case "720p":
        resolutionDimensions = "1280x720";
        break;
      case "480p":
      default:
        resolutionDimensions = "854x480";
        break;
    }

    const { videos } = await generateVideo({
      model: getXai().video("grok-imagine-video"),
      prompt: {
        image: imageInput,
        text: prompt,
      },
      duration: options?.duration ?? 3,
      // Omit aspectRatio so the API uses the input image's aspect ratio (xAI default for image-to-video).
      ...(options?.aspectRatio != null && {
        aspectRatio: options.aspectRatio as "16:9" | "1:1" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3",
      }),
      resolution: resolutionDimensions,
      providerOptions: {
        xai: {
          pollTimeoutMs: 600_000, // 10 min
        },
      },
      // SDK downloads the video URL with its own fetch (CORS). Use our proxy for vidgen.x.ai.
      download: proxyDownload,
    });

    const first = videos?.[0];
    if (!first) throw new Error("No video in response");

    // Track successful generation
    trackModerationEvent({
      type: 'video',
      prompt,
      inputImage: imageDataUri,
      moderated: false,
      model: 'grok-imagine-video',
      metadata: {
        mode: "generate",
        duration: options?.duration ?? 3,
        resolution: options?.resolution ?? '480p',
      },
    });

    const dataUrl = `data:${first.mediaType};base64,${first.base64}`;
    const sourceUrl = capturedCdnUrls.length > 0 ? capturedCdnUrls[capturedCdnUrls.length - 1] : null;

    return { dataUrl, sourceUrl };
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    const moderated = isModerationError(errorMessage);

    // Track moderation event
    trackModerationEvent({
      type: 'video',
      prompt,
      inputImage: imageDataUri,
      moderated,
      errorMessage,
      model: 'grok-imagine-video',
      metadata: {
        duration: options?.duration ?? 3,
        resolution: options?.resolution ?? '480p',
      },
    });

    throw new Error(errorMessage);
  }
}

/**
 * Video editing / extension: send a source video URL + prompt, returns edited video as a data URL + CDN source URL.
 * xAI keeps the source video's duration, aspect ratio, and resolution for edits.
 */
export async function videoEdit(
  prompt: string,
  sourceVideoUrl: string,
  sourceVideoName?: string | null,
  options?: { pollTimeoutMs?: number; pollIntervalMs?: number }
): Promise<VideoResult> {
  try {
    clearLastXaiApiErrorTrace();
    if (/^(data:|blob:|file:)/i.test(sourceVideoUrl)) {
      throw new Error("xAI video edits require a public, fetchable video URL. Local files need to be uploaded to a hosted URL first.");
    }

    capturedCdnUrls = [];

    const result = await runVideoJob(
      "/videos/edits",
      {
        model: "grok-imagine-video",
        prompt,
        video: { url: sourceVideoUrl },
      },
      options
    );

    trackModerationEvent({
      type: 'video',
      prompt,
      inputImage: sourceVideoName ?? sourceVideoUrl,
      moderated: false,
      model: 'grok-imagine-video',
      metadata: {
        mode: "edit",
        sourceVideoUrl,
        ...(sourceVideoName ? { sourceVideoName } : {}),
      },
    });

    return result;
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    const moderated = isModerationError(errorMessage);

    trackModerationEvent({
      type: 'video',
      prompt,
      inputImage: sourceVideoName ?? sourceVideoUrl,
      moderated,
      errorMessage,
      model: 'grok-imagine-video',
      metadata: {
        mode: "edit",
        sourceVideoUrl,
        ...(sourceVideoName ? { sourceVideoName } : {}),
      },
    });

    throw new Error(errorMessage);
  }
}

/**
 * Video extension: send a source video URL + prompt, returns extended video as a data URL + CDN source URL.
 * Uses xAI's /videos/extensions endpoint directly so the request follows the current extension docs.
 */
export async function videoExtend(
  prompt: string,
  sourceVideoUrl: string,
  sourceVideoName?: string | null,
  options?: { pollTimeoutMs?: number; pollIntervalMs?: number; duration?: number }
): Promise<VideoResult> {
  try {
    clearLastXaiApiErrorTrace();
    if (/^(data:|blob:|file:)/i.test(sourceVideoUrl)) {
      throw new Error("xAI video extensions require a public, fetchable video URL. Local files need to be uploaded to a hosted URL first.");
    }

    // Clear captured URLs before generation
    capturedCdnUrls = [];

    const duration = options?.duration ?? 6;
    const result = await runVideoJob(
      "/videos/extensions",
      {
        model: "grok-imagine-video",
        prompt,
        duration,
        video: { url: sourceVideoUrl },
      },
      options
    );

    // Track successful generation
    trackModerationEvent({
      type: 'video',
      prompt,
      inputImage: sourceVideoName ?? sourceVideoUrl,
      moderated: false,
      model: 'grok-imagine-video',
      metadata: {
        mode: "extend",
        sourceVideoUrl,
        ...(sourceVideoName ? { sourceVideoName } : {}),
        duration,
      },
    });

    return result;
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    const moderated = isModerationError(errorMessage);

    // Track moderation event
    trackModerationEvent({
      type: 'video',
      prompt,
      inputImage: sourceVideoName ?? sourceVideoUrl,
      moderated,
      errorMessage,
      model: 'grok-imagine-video',
      metadata: {
        mode: "extend",
        sourceVideoUrl,
        ...(sourceVideoName ? { sourceVideoName } : {}),
        duration: options?.duration ?? 6,
      },
    });

    throw new Error(errorMessage);
  }
}
