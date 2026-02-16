/**
 * Auto-save functionality using File System Access API
 * Allows saving generated images and videos to a user-selected folder
 */

// Check if File System Access API is supported
export function isAutoSaveSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

// Store the directory handle in memory
let directoryHandle: FileSystemDirectoryHandle | null = null;

/**
 * Prompt user to select a destination folder for auto-saving
 */
export async function selectAutoSaveFolder(): Promise<boolean> {
  if (!isAutoSaveSupported()) {
    throw new Error("File System Access API is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.");
  }

  try {
    // Request directory access
    directoryHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads',
    });
    
    // Store in localStorage for persistence across sessions
    localStorage.setItem('autoSaveEnabled', 'true');
    
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // User cancelled the picker
      return false;
    }
    throw err;
  }
}

/**
 * Check if auto-save is currently enabled
 * Only returns true if we have an active directory handle
 */
export function isAutoSaveEnabled(): boolean {
  return directoryHandle !== null;
}

/**
 * Disable auto-save
 */
export function disableAutoSave(): void {
  directoryHandle = null;
  localStorage.removeItem('autoSaveEnabled');
}

/**
 * Get the current auto-save directory handle
 * Returns null if not available (doesn't prompt user)
 */
async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (directoryHandle) {
    return directoryHandle;
  }

  // If auto-save was enabled before but handle is lost (page refresh),
  // silently disable it - user must manually re-enable
  // This prevents the "user gesture" error when trying to show picker after async operations
  if (localStorage.getItem('autoSaveEnabled') === 'true') {
    console.warn('Auto-save folder handle lost (page refresh). Please re-enable auto-save in settings.');
    disableAutoSave();
  }

  return null;
}

/**
 * Convert data URL to Blob
 */
function dataURLtoBlob(dataURL: string): Blob {
  const parts = dataURL.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const bstr = atob(parts[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Auto-save a file (image or video) to the selected folder
 */
export async function autoSaveFile(
  dataURL: string,
  filename: string,
  type: 'image' | 'video'
): Promise<boolean> {
  if (!isAutoSaveSupported()) {
    console.warn('Auto-save not supported in this browser');
    return false;
  }

  const dirHandle = await getDirectoryHandle();
  if (!dirHandle) {
    console.warn('No directory selected for auto-save');
    return false;
  }

  try {
    // Create the file in the selected directory
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    
    // Create a writable stream
    const writable = await fileHandle.createWritable();
    
    // Convert data URL to blob and write
    const blob = dataURLtoBlob(dataURL);
    await writable.write(blob);
    await writable.close();
    
    console.log(`Auto-saved ${type}: ${filename}`);
    return true;
  } catch (err) {
    console.error('Failed to auto-save file:', err);
    
    // If permission was denied, disable auto-save
    if (err instanceof Error && err.name === 'NotAllowedError') {
      disableAutoSave();
    }
    
    return false;
  }
}

/**
 * Generate a filename for auto-saving
 */
export function generateAutoSaveFilename(type: 'image' | 'video', index?: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const suffix = index !== undefined ? `-${index + 1}` : '';
  const extension = type === 'image' ? 'jpg' : 'mp4';
  return `grok-${type}-${timestamp}${suffix}.${extension}`;
}

