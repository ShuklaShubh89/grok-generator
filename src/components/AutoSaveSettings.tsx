import { useState, useEffect } from "react";
import {
  isAutoSaveSupported,
  isAutoSaveEnabled,
  selectAutoSaveFolder,
  disableAutoSave,
} from "../lib/autoSave";

export default function AutoSaveSettings() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);
  const [showRefreshWarning, setShowRefreshWarning] = useState(false);

  useEffect(() => {
    setSupported(isAutoSaveSupported());
    const currentlyEnabled = isAutoSaveEnabled();
    setEnabled(currentlyEnabled);

    // Check if auto-save was previously enabled but handle is lost
    const wasEnabled = localStorage.getItem('autoSaveEnabled') === 'true';
    if (wasEnabled && !currentlyEnabled) {
      setShowRefreshWarning(true);
      // Clear the warning after showing it once
      setTimeout(() => setShowRefreshWarning(false), 10000);
    }

    // Refresh enabled state periodically in case it was disabled due to lost handle
    const interval = setInterval(() => {
      setEnabled(isAutoSaveEnabled());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleToggle = async () => {
    if (enabled) {
      // Disable auto-save
      disableAutoSave();
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
          />
          <span>{enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      {showRefreshWarning && (
        <div className="auto-save-warning">
          <p>⚠️ Auto-save was disabled due to page refresh. Please re-enable it to continue auto-saving.</p>
        </div>
      )}

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

