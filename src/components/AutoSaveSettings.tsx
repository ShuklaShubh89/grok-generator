import { useState, useEffect } from "react";
import {
  isAutoSaveSupported,
  isAutoSaveEnabled,
  selectAutoSaveFolder,
  disableAutoSave,
  initializeAutoSave,
} from "../lib/autoSave";

export default function AutoSaveSettings() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    setSupported(isAutoSaveSupported());

    // Initialize auto-save on component mount
    const init = async () => {
      await initializeAutoSave();
      setEnabled(isAutoSaveEnabled());
      setInitializing(false);
    };

    init();

    // Refresh enabled state periodically
    const interval = setInterval(() => {
      setEnabled(isAutoSaveEnabled());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleToggle = async () => {
    if (enabled) {
      // Disable auto-save
      await disableAutoSave();
      setEnabled(false);
    } else {
      // Enable auto-save - prompt for folder
      try {
        const success = await selectAutoSaveFolder();
        if (success) {
          setEnabled(true);
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to enable auto-save");
      }
    }
  };

  const handleChangeFolder = async () => {
    try {
      const success = await selectAutoSaveFolder();
      if (success) {
        setEnabled(true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to select folder");
    }
  };

  if (!supported) {
    return (
      <div className="auto-save-settings">
        <div className="auto-save-unsupported">
          <p>⚠️ Auto-save is not supported in this browser.</p>
          <p className="auto-save-hint">
            Please use Chrome, Edge, or another Chromium-based browser to enable auto-save.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auto-save-settings">
      <div className="auto-save-header">
        <h3>💾 Auto-Save</h3>
        <label className="auto-save-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleToggle}
            disabled={initializing}
          />
          <span>{initializing ? "Loading..." : enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      {enabled ? (
        <div className="auto-save-info">
          <p className="auto-save-status">
            ✅ Generated images and videos will be automatically saved to your selected folder.
          </p>
          <button
            type="button"
            className="btn-change-folder"
            onClick={handleChangeFolder}
          >
            Change Folder
          </button>
        </div>
      ) : (
        <p className="auto-save-hint">
          Enable auto-save to automatically save all generated images and videos to a folder of your choice.
        </p>
      )}
    </div>
  );
}

