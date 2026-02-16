import { useState, useEffect } from "react";
import { getHistory, deleteHistoryItem, clearHistory, type HistoryItem } from "../lib/history";

export default function History() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

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
    }
  };

  const handleDownload = (item: HistoryItem) => {
    const link = document.createElement("a");
    link.href = item.resultUrl;
    const extension = item.type === "video" ? "mp4" : "jpg";
    const timestamp = new Date(item.timestamp).toISOString().slice(0, 10);
    link.download = `grok-${item.type}-${timestamp}.${extension}`;
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
          <button type="button" onClick={handleClearAll} className="btn-clear-history">
            Clear All
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="empty-state">No generations yet. Create some images or videos to see them here!</p>
      ) : (
        <div className="history-layout">
          <div className="history-grid">
            {history.map((item) => (
              <div
                key={item.id}
                className={`history-card ${selectedItem?.id === item.id ? "selected" : ""}`}
                onClick={() => setSelectedItem(item)}
              >
                <div className="history-card-preview">
                  {item.type === "video" ? (
                    <video src={item.resultUrl} className="history-thumbnail" />
                  ) : (
                    <img src={item.resultUrl} alt="Generated" className="history-thumbnail" />
                  )}
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
                {selectedItem.type === "video" ? (
                  <video src={selectedItem.resultUrl} controls className="history-detail-media" />
                ) : (
                  <img src={selectedItem.resultUrl} alt="Generated" className="history-detail-media" />
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

