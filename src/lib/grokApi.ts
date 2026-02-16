import { createXai } from "@ai-sdk/xai";
import { generateImage } from "ai";
import { experimental_generateVideo as generateVideo } from "ai";

let userApiKey: string | null = null;

/** Set the API key from the UI input (overrides env). Pass null to clear. */
export function setGrokApiKey(key: string | null): void {
  userApiKey = key?.trim() || null;
}

function getApiKey(): string {
  if (!userApiKey) throw new Error("Grok API key is not set. Please log in.");
  return userApiKey;
}

const getBaseUrl = () =>
  import.meta.env.VITE_GROK_API_URL ?? "https://api.x.ai/v1";

const XAI_CDN_PREFIXES = ["https://imgen.x.ai/", "https://vidgen.x.ai/"];

function useProxy(url: string): boolean {
  return XAI_CDN_PREFIXES.some((p) => url.startsWith(p));
}

/** Custom fetch so requests to imgen.x.ai and vidgen.x.ai go via our proxy (avoids CORS). */
function grokFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (useProxy(url)) {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    return fetch(proxyUrl, init);
  }
  return fetch(input, init);
}

/** Custom download for generateVideo: fetches video URLs via our proxy to avoid CORS. */
async function proxyDownload(options: {
  url: URL;
  abortSignal?: AbortSignal;
}): Promise<{ data: Uint8Array; mediaType: string | undefined }> {
  const href = options.url.href;
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

/**
 * Image edit: send image (data URI or URL) + prompt, returns image(s) as data URL(s).
 * Uses Grok SDK (generateImage with grok-imagine-image or grok-imagine-image-pro).
 */
export async function imageEdit(
  prompt: string,
  imageDataUri: string,
  options?: { model?: "grok-imagine-image" | "grok-imagine-image-pro"; count?: number }
): Promise<string[]> {
  try {
    // Compress image before sending to API to reduce costs
    const compressed = await compressImage(imageDataUri, 1024, 0.85);

    const imageInput = compressed.startsWith("http")
      ? new Uint8Array(await (await fetch(compressed)).arrayBuffer())
      : dataUriToUint8Array(compressed);

    const modelName = options?.model ?? "grok-imagine-image";
    const imageCount = options?.count ?? 1;

    const { images } = await generateImage({
      model: getXai().image(modelName),
      prompt: {
        text: prompt,
        images: [imageInput],
      },
      n: imageCount,
    });

    if (!images || images.length === 0) throw new Error("No images in response");
    return images.map((img) => `data:${img.mediaType};base64,${img.base64}`);
  } catch (err) {
    throw new Error(getErrorMessage(err));
  }
}

/**
 * Image-to-video: send image (data URI) + prompt, returns video as data URL.
 * Uses Grok SDK (experimental_generateVideo with grok-imagine-video). Polling is handled by the SDK.
 */
export async function imageToVideo(
  prompt: string,
  imageDataUri: string,
  options?: { duration?: number; aspectRatio?: string; resolution?: string }
): Promise<string> {
  try {
    // Compress image before sending to API to reduce costs
    const compressed = await compressImage(imageDataUri, 1024, 0.85);

    const imageInput = compressed.startsWith("http")
      ? compressed
      : dataUriToUint8Array(compressed);

    // Map resolution options to actual dimensions
    let resolutionDimensions: `${number}x${number}`;
    switch (options?.resolution) {
      case "720p":
        resolutionDimensions = "1280x720";
        break;
      case "360p":
        resolutionDimensions = "640x360";
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
    return `data:${first.mediaType};base64,${first.base64}`;
  } catch (err) {
    throw new Error(getErrorMessage(err));
  }
}
