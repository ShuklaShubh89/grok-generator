import { useState, useEffect } from "react";
import { getHistory, deleteHistoryItem, deleteHistoryItems, clearHistory, type HistoryItem } from "../lib/history";
import ModerationStats from "../components/ModerationStats";

export default function History() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = () => {
    setHistory(getHistory());
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this item from history?")) {
      deleteHistoryItem(id);
      loadHistory();
      if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
    }
  };

  const handleClearAll = () => {
    if (confirm("Clear all history? This cannot be undone.")) {
      clearHistory();
      loadHistory();
      setSelectedItem(null);
      setSelectedIds(new Set());
      setSelectionMode(false);
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedIds(new Set());
    setSelectedItem(null);
  };

  const toggleItemSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    if (confirm(`Delete ${count} selected item${count > 1 ? "s" : ""}?`)) {
      deleteHistoryItems(Array.from(selectedIds));
      loadHistory();
      setSelectedIds(new Set());
      setSelectionMode(false);
    }
  };

  const selectAll = () => {
    setSelectedIds(new Set(history.map(item => item.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleDownload = (item: HistoryItem) => {
    const link = document.createElement("a");
    link.href = item.resultUrl;
    // Videos are stored as thumbnails, so download as jpg
    const extension = "jpg";
    const timestamp = new Date(item.timestamp).toISOString().slice(0, 10);
    const typeLabel = item.type === "video" ? "video-thumbnail" : "image";
    link.download = `grok-${typeLabel}-${timestamp}.${extension}`;
    link.click();
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="page history-page">
      <div className="history-header">
        <h1>Generation History</h1>
        {history.length > 0 && (
          <div className="history-header-actions">
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`btn-select-mode ${selectionMode ? "active" : ""}`}
            >
              {selectionMode ? "Cancel" : "Select"}
            </button>
            {!selectionMode && (
              <button type="button" onClick={handleClearAll} className="btn-clear-history">
                Clear All
              </button>
            )}
          </div>
        )}
      </div>

      <ModerationStats />

      {selectionMode && history.length > 0 && (
        <div className="selection-toolbar">
          <div className="selection-info">
            {selectedIds.size > 0 ? (
              <span>{selectedIds.size} item{selectedIds.size > 1 ? "s" : ""} selected</span>
            ) : (
              <span>Select items to delete</span>
            )}
          </div>
          <div className="selection-actions">
            <button type="button" onClick={selectAll} className="btn-select-all">
              Select All
            </button>
            {selectedIds.size > 0 && (
              <>
                <button type="button" onClick={deselectAll} className="btn-deselect-all">
                  Deselect All
                </button>
                <button type="button" onClick={handleDeleteSelected} className="btn-delete-selected">
                  Delete Selected ({selectedIds.size})
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <p className="empty-state">No generations yet. Create some images or videos to see them here!</p>
      ) : (
        <div className="history-layout">
          <div className="history-grid">
            {history.map((item) => (
              <div
                key={item.id}
                className={`history-card ${selectedItem?.id === item.id && !selectionMode ? "selected" : ""} ${selectedIds.has(item.id) ? "checked" : ""}`}
                onClick={() => {
                  if (selectionMode) {
                    toggleItemSelection(item.id);
                  } else {
                    setSelectedItem(item);
                  }
                }}
              >
                {selectionMode && (
                  <div className="history-card-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleItemSelection(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
                <div className="history-card-preview">
                  {/* Always show as image since we store thumbnails for videos */}
                  <img src={item.resultUrl} alt="Generated" className="history-thumbnail" />
                  <div className="history-card-type">
                    {item.type === "video" ? "🎥" : "🖼️"}
                  </div>
                </div>
                <div className="history-card-info">
                  <p className="history-card-prompt">{item.prompt}</p>
                  <p className="history-card-date">{formatDate(item.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>

          {selectedItem && (
            <div className="history-detail">
              <div className="history-detail-header">
                <h2>Details</h2>
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="btn-close"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="history-detail-content">
                {/* Show thumbnail for videos since we don't store full videos */}
                <img src={selectedItem.resultUrl} alt="Generated" className="history-detail-media" />
                {selectedItem.type === "video" && (
                  <p className="video-note">
                    <em>Note: This is a thumbnail of the generated video. Full videos are not stored in history to save space.</em>
                  </p>
                )}

                <div className="history-detail-info">
                  <p><strong>Prompt:</strong> {selectedItem.prompt}</p>
                  <p><strong>Type:</strong> {selectedItem.type === "video" ? "Video" : "Image"}</p>
                  <p><strong>Created:</strong> {new Date(selectedItem.timestamp).toLocaleString()}</p>
                  {selectedItem.metadata?.duration && (
                    <p><strong>Duration:</strong> {selectedItem.metadata.duration}s</p>
                  )}
                  {selectedItem.metadata?.resolution && (
                    <p><strong>Resolution:</strong> {selectedItem.metadata.resolution}</p>
                  )}
                  {selectedItem.metadata?.model && (
                    <p><strong>Model:</strong> {selectedItem.metadata.model}</p>
                  )}
                  {selectedItem.metadata?.imageCount && selectedItem.metadata.imageCount > 1 && (
                    <p><strong>Count:</strong> {selectedItem.metadata.imageCount} images</p>
                  )}
                </div>

                <div className="history-detail-actions">
                  <button type="button" onClick={() => handleDownload(selectedItem)}>
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedItem.id)}
                    className="btn-delete"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

