const HISTORY_KEY = "grok-generation-history";
const MAX_HISTORY_ITEMS = 100; // Limit to prevent localStorage overflow

export interface HistoryItem {
  id: string;
  type: "image" | "video";
  prompt: string;
  inputImage?: string; // Thumbnail of input (optional)
  resultUrl: string; // Data URL of the result
  timestamp: number;
  metadata?: {
    duration?: number;
    resolution?: string;
    model?: string;
    imageCount?: number;
  };
}

/**
 * Get all history items from localStorage
 */
export function getHistory(): HistoryItem[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) return [];
    const items = JSON.parse(stored) as HistoryItem[];
    // Sort by timestamp, newest first
    return items.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    console.error("Failed to load history:", err);
    return [];
  }
}

/**
 * Add a new item to history
 */
export function addToHistory(item: Omit<HistoryItem, "id" | "timestamp">): void {
  try {
    const history = getHistory();
    const newItem: HistoryItem = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    
    // Add to beginning and limit size
    const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to save to history:", err);
    // If localStorage is full, try to clear old items
    try {
      const history = getHistory();
      const reduced = [item, ...history.slice(0, 50)];
      localStorage.setItem(HISTORY_KEY, JSON.stringify(reduced));
    } catch {
      // Give up silently if still failing
    }
  }
}

/**
 * Delete a specific history item by ID
 */
export function deleteHistoryItem(id: string): void {
  try {
    const history = getHistory();
    const updated = history.filter((item) => item.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to delete history item:", err);
  }
}

/**
 * Delete multiple history items by IDs
 */
export function deleteHistoryItems(ids: string[]): void {
  try {
    const history = getHistory();
    const idsSet = new Set(ids);
    const updated = history.filter((item) => !idsSet.has(item.id));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to delete history items:", err);
  }
}

/**
 * Clear all history
 */
export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (err) {
    console.error("Failed to clear history:", err);
  }
}

/**
 * Create a thumbnail from a data URL (for storage efficiency)
 */
export function createThumbnail(dataUrl: string, maxSize = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      // Scale down to thumbnail size
      if (width > height) {
        if (width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG with low quality for thumbnail
      const thumbnail = canvas.toDataURL("image/jpeg", 0.6);
      resolve(thumbnail);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

/**
 * Create a thumbnail from a video data URL by capturing the first frame
 */
export function createVideoThumbnail(videoDataUrl: string, maxSize = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      // Seek to 0.1 seconds to avoid black frame
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        let { videoWidth: width, videoHeight: height } = video;

        // Scale down to thumbnail size
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        ctx.drawImage(video, 0, 0, width, height);

        // Convert to JPEG with low quality for thumbnail
        const thumbnail = canvas.toDataURL("image/jpeg", 0.6);
        resolve(thumbnail);
      } catch (err) {
        reject(err);
      }
    };

    video.onerror = () => reject(new Error("Failed to load video"));
    video.src = videoDataUrl;
  });
}

