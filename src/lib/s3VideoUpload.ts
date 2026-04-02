export interface UploadedPrivateVideo {
  sourceVideoUrl: string;
  sourceVideoName: string;
  key: string;
}

export type UploadProgressCallback = (percent: number) => void;

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
      reject(new Error("S3 upload failed due to a network error"));
    };

    xhr.onabort = () => {
      reject(new Error("S3 upload was cancelled"));
    };

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
  };

  await uploadFileToPresignedUrl(data.uploadUrl, file, {
    ...(data.uploadHeaders ?? {}),
    "Content-Type": file.type || "video/mp4",
  }, onProgress);

  return {
    sourceVideoUrl: data.downloadUrl,
    sourceVideoName: file.name,
    key: data.key,
  };
}
