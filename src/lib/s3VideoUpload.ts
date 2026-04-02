export interface UploadedPrivateVideo {
  sourceVideoUrl: string;
  sourceVideoName: string;
  key: string;
  cached: boolean;
}

export type UploadProgressCallback = (percent: number) => void;

interface CachedUploadRecord {
  sourceVideoUrl: string;
  sourceVideoName: string;
  key: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  expiresAt: number;
}

const VIDEO_UPLOAD_CACHE_KEY = "grok-private-video-upload-cache";

function getUploadCache(): CachedUploadRecord[] {
  try {
    const raw = localStorage.getItem(VIDEO_UPLOAD_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedUploadRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) =>
      typeof entry?.sourceVideoUrl === "string" &&
      typeof entry?.sourceVideoName === "string" &&
      typeof entry?.key === "string" &&
      typeof entry?.fileName === "string" &&
      typeof entry?.fileSize === "number" &&
      typeof entry?.lastModified === "number" &&
      typeof entry?.expiresAt === "number"
    );
  } catch {
    return [];
  }
}

function saveUploadCache(entry: CachedUploadRecord): void {
  try {
    const next = getUploadCache()
      .filter((item) => item.key !== entry.key)
      .filter((item) => item.expiresAt > Date.now());
    next.unshift(entry);
    localStorage.setItem(VIDEO_UPLOAD_CACHE_KEY, JSON.stringify(next.slice(0, 20)));
  } catch {
    // Ignore cache failures; upload can still proceed.
  }
}

function findCachedUpload(file: File): CachedUploadRecord | null {
  const now = Date.now();
  const entries = getUploadCache();
  const exactMatch = entries.find((entry) =>
    entry.expiresAt > now &&
    entry.fileName === file.name &&
    entry.fileSize === file.size &&
    entry.lastModified === file.lastModified
  );
  if (exactMatch) return exactMatch;

  // Fallback for cases where the file picker normalizes metadata differently but the same file name is reused.
  return entries.find((entry) =>
    entry.expiresAt > now &&
    entry.fileName === file.name &&
    entry.fileSize === file.size
  ) ?? null;
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

function uploadFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  uploadHeaders: Record<string, string>,
  onProgress?: UploadProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", uploadUrl);

    for (const [headerName, headerValue] of Object.entries(uploadHeaders)) {
      xhr.setRequestHeader(headerName, headerValue);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`S3 upload failed with status ${xhr.status}`));
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "S3 upload failed due to a network error. This usually means the bucket CORS policy does not allow PUT from this app origin, or the presigned URL could not be reached."
        )
      );
    };

    xhr.onabort = () => {
      reject(new Error("S3 upload was cancelled"));
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          "S3 upload timed out. Check the bucket CORS policy, the presigned URL, and whether the file is unusually large."
        )
      );
    };

    xhr.timeout = 120_000;

    xhr.send(file);
  });
}

export async function uploadPrivateVideoForExtension(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<UploadedPrivateVideo> {
  if (!(file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4"))) {
    throw new Error("Please select an MP4 file.");
  }

  const cached = findCachedUpload(file);
  if (cached) {
    onProgress?.(100);
    return {
      sourceVideoUrl: cached.sourceVideoUrl,
      sourceVideoName: cached.sourceVideoName,
      key: cached.key,
      cached: true,
    };
  }

  const presignResponse = await fetch("/api/s3-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "video/mp4",
    }),
  });

  if (!presignResponse.ok) {
    throw new Error(await readApiError(presignResponse));
  }

  const data = (await presignResponse.json()) as {
    key: string;
    uploadUrl: string;
    downloadUrl: string;
    uploadHeaders?: Record<string, string>;
    downloadExpiresSeconds?: number;
  };

  await uploadFileToPresignedUrl(data.uploadUrl, file, {
    ...(data.uploadHeaders ?? {}),
    "Content-Type": file.type || "video/mp4",
  }, onProgress);

  saveUploadCache({
    sourceVideoUrl: data.downloadUrl,
    sourceVideoName: file.name,
    key: data.key,
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    expiresAt: Date.now() + ((data.downloadExpiresSeconds ?? 21_600) * 1000),
  });

  return {
    sourceVideoUrl: data.downloadUrl,
    sourceVideoName: file.name,
    key: data.key,
    cached: false,
  };
}
