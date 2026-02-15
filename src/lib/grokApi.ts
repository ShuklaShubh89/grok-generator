import { createXai } from "@ai-sdk/xai";
import { generateImage } from "ai";
import { experimental_generateVideo as generateVideo } from "ai";

const getApiKey = () => {
  const key = import.meta.env.VITE_GROK_API_KEY;
  if (!key) throw new Error("VITE_GROK_API_KEY is not set");
  return key;
};

const getBaseUrl = () =>
  import.meta.env.VITE_GROK_API_URL ?? "https://api.x.ai/v1";

/** Custom fetch so requests to imgen.x.ai and vidgen.x.ai go via our proxy (avoids CORS). */
function grokFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url.startsWith("https://imgen.x.ai/") || url.startsWith("https://vidgen.x.ai/")) {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    return fetch(proxyUrl, init);
  }
  return fetch(input, init);
}

const xai = createXai({
  apiKey: getApiKey(),
  baseURL: getBaseUrl(),
  fetch: grokFetch,
});

function dataUriToUint8Array(dataUri: string): Uint8Array {
  const base64 = dataUri.includes(",") ? dataUri.split(",")[1]! : dataUri;
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

/**
 * Image edit: send image (data URI or URL) + prompt, returns image as data URL.
 * Uses Grok SDK (generateImage with grok-imagine-image).
 */
export async function imageEdit(
  prompt: string,
  imageDataUri: string
): Promise<string> {
  const imageInput = imageDataUri.startsWith("http")
    ? new Uint8Array(await (await fetch(imageDataUri)).arrayBuffer())
    : dataUriToUint8Array(imageDataUri);

  const { images } = await generateImage({
    model: xai.image("grok-imagine-image"),
    prompt: {
      text: prompt,
      images: [imageInput],
    },
  });

  const first = images?.[0];
  if (!first) throw new Error("No image in response");
  return `data:${first.mediaType};base64,${first.base64}`;
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
  const imageInput = imageDataUri.startsWith("http")
    ? imageDataUri
    : dataUriToUint8Array(imageDataUri);

  const { videos } = await generateVideo({
    model: xai.video("grok-imagine-video"),
    prompt: {
      image: imageInput,
      text: prompt,
    },
    duration: options?.duration ?? 5,
    // Omit aspectRatio so the API uses the input image's aspect ratio (xAI default for image-to-video).
    ...(options?.aspectRatio != null && {
      aspectRatio: options.aspectRatio as "16:9" | "1:1" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3",
    }),
    resolution:
      options?.resolution === "720p"
        ? "1280x720"
        : "854x480",
    providerOptions: {
      xai: {
        pollTimeoutMs: 600_000, // 10 min
      },
    },
  });

  const first = videos?.[0];
  if (!first) throw new Error("No video in response");
  return `data:${first.mediaType};base64,${first.base64}`;
}
