/**
 * Auto-save functionality using File System Access API
 * Allows saving generated images and videos to a user-selected folder
 */

// Check if File System Access API is supported
export function isAutoSaveSupported(): boolean {
  return 'showDirectoryPicker' in window && 'indexedDB' in window;
}

// Store the directory handle in memory
let directoryHandle: FileSystemDirectoryHandle | null = null;

// IndexedDB database name and store
const DB_NAME = 'grok-autosave-db';
const DB_VERSION = 1;
const STORE_NAME = 'directory-handles';
const HANDLE_KEY = 'autosave-directory';

/**
 * Open IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Save directory handle to IndexedDB
 */
async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(handle, HANDLE_KEY);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Load directory handle from IndexedDB
 */
async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(HANDLE_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  } catch (err) {
    console.error('Failed to load directory handle from IndexedDB:', err);
    return null;
  }
}

/**
 * Delete directory handle from IndexedDB
 */
async function deleteDirectoryHandle(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(HANDLE_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (err) {
    console.error('Failed to delete directory handle from IndexedDB:', err);
  }
}

/**
 * Prompt user to select a destination folder for auto-saving
 */
export async function selectAutoSaveFolder(): Promise<boolean> {
  if (!isAutoSaveSupported()) {
    throw new Error("File System Access API is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.");
  }

  try {
    // Request directory access
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads',
    });

    // Store in memory
    directoryHandle = handle;

    // Persist to IndexedDB for future sessions
    await saveDirectoryHandle(handle);

    // Store flag in localStorage
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
export async function disableAutoSave(): Promise<void> {
  directoryHandle = null;
  localStorage.removeItem('autoSaveEnabled');
  await deleteDirectoryHandle();
}

/**
 * Initialize auto-save on app startup
 * Attempts to restore the directory handle from IndexedDB
 */
export async function initializeAutoSave(): Promise<void> {
  if (!isAutoSaveSupported()) {
    return;
  }

  // Check if auto-save was enabled
  if (localStorage.getItem('autoSaveEnabled') !== 'true') {
    return;
  }

  try {
    // Try to load the saved directory handle
    const handle = await loadDirectoryHandle();
    if (!handle) {
      console.warn('No saved directory handle found');
      localStorage.removeItem('autoSaveEnabled');
      return;
    }

    // Verify we still have permission to access the directory
    const permission = await handle.queryPermission({ mode: 'readwrite' });

    if (permission === 'granted') {
      // Permission already granted, restore the handle
      directoryHandle = handle;
      console.log('Auto-save directory restored:', handle.name);
    } else if (permission === 'prompt') {
      // Need to request permission again
      const newPermission = await handle.requestPermission({ mode: 'readwrite' });
      if (newPermission === 'granted') {
        directoryHandle = handle;
        console.log('Auto-save directory restored with new permission:', handle.name);
      } else {
        console.warn('Permission denied for saved directory');
        await disableAutoSave();
      }
    } else {
      // Permission denied
      console.warn('Permission denied for saved directory');
      await disableAutoSave();
    }
  } catch (err) {
    console.error('Failed to restore auto-save directory:', err);
    await disableAutoSave();
  }
}

/**
 * Get the current auto-save directory handle
 * Returns null if not available (doesn't prompt user)
 */
async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return directoryHandle;
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

