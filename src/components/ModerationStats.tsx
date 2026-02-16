import { useState, useEffect } from "react";
import { getModerationStats, clearModerationHistory } from "../lib/moderationTracking";
import type { ModerationStats as Stats } from "../lib/moderationTracking";
import { PRICING } from "../lib/pricing";

interface ModerationStatsProps {
  filterType?: 'image' | 'video'; // Optional filter to show only specific type
}

export default function ModerationStats({ filterType }: ModerationStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const loadStats = () => {
    const data = getModerationStats();
    setStats(data);
  };

  useEffect(() => {
    loadStats();
    
    // Refresh stats every 5 seconds
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleClear = () => {
    if (confirm("Are you sure you want to clear all moderation history? This cannot be undone.")) {
      clearModerationHistory();
      loadStats();
    }
  };

  // Filter stats based on type if specified
  const getFilteredStats = () => {
    if (!stats) return null;

    if (filterType === 'image') {
      return {
        totalAttempts: stats.imageAttempts,
        totalModerated: stats.imageModerated,
        totalCost: stats.imageAttempts * PRICING.image["grok-imagine-image"].total, // $0.022 per image
        totalWasted: stats.imageModerated * PRICING.image["grok-imagine-image"].total, // $0.022 per image
        moderationRate: stats.imageModerationRate,
      };
    } else if (filterType === 'video') {
      // For videos, we'll use an average cost estimate (3s @ 480p as baseline)
      const avgVideoCost = PRICING.video.imageInput + (PRICING.video.perSecond["480p"] * 3);
      return {
        totalAttempts: stats.videoAttempts,
        totalModerated: stats.videoModerated,
        totalCost: stats.videoAttempts * avgVideoCost, // Approximate
        totalWasted: stats.videoModerated * avgVideoCost, // Approximate
        moderationRate: stats.videoModerationRate,
      };
    }

    // No filter - show all stats
    return {
      totalAttempts: stats.totalAttempts,
      totalModerated: stats.totalModerated,
      totalCost: stats.totalCost,
      totalWasted: stats.totalWasted,
      moderationRate: stats.moderationRate,
    };
  };

  const filteredStats = getFilteredStats();

  if (!filteredStats || filteredStats.totalAttempts === 0) {
    const typeLabel = filterType === 'image' ? 'image' : filterType === 'video' ? 'video' : 'image or video';
    return (
      <div className="moderation-stats">
        <div className="moderation-stats-header">
          <h3>📊 Moderation Tracking {filterType && `(${filterType === 'image' ? 'Images' : 'Videos'})`}</h3>
        </div>
        <p className="moderation-stats-empty">
          No {typeLabel} generation attempts tracked yet. Start generating to see moderation statistics.
        </p>
      </div>
    );
  }

  const formatCost = (cost: number) => `$${cost.toFixed(2)}`;
  const formatPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

  return (
    <div className="moderation-stats">
      <div className="moderation-stats-header">
        <h3>📊 Moderation Tracking {filterType && `(${filterType === 'image' ? 'Images' : 'Videos'})`}</h3>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="btn-toggle-details"
        >
          {showDetails ? "Hide Details" : "Show Details"}
        </button>
      </div>

      <div className="moderation-stats-summary">
        <div className="stat-card">
          <div className="stat-label">Total Attempts</div>
          <div className="stat-value">{filteredStats.totalAttempts}</div>
        </div>

        <div className="stat-card stat-danger">
          <div className="stat-label">Moderated</div>
          <div className="stat-value">{filteredStats.totalModerated}</div>
          <div className="stat-subtitle">{formatPercent(filteredStats.moderationRate)}</div>
        </div>

        <div className="stat-card stat-warning">
          <div className="stat-label">Wasted</div>
          <div className="stat-value">{formatCost(filteredStats.totalWasted)}</div>
          <div className="stat-subtitle">of {formatCost(filteredStats.totalCost)}</div>
        </div>
      </div>

      <div className="moderation-fee-note">
        ℹ️ Moderated content costs include generation fee + $0.05 moderation fee
      </div>

      {showDetails && !filterType && (
        <div className="moderation-stats-details">
          <div className="stats-section">
            <h4>🖼️ Image Generation</h4>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-item-label">Attempts:</span>
                <span className="stat-item-value">{stats.imageAttempts}</span>
              </div>
              <div className="stat-item">
                <span className="stat-item-label">Moderated:</span>
                <span className="stat-item-value stat-danger-text">{stats.imageModerated}</span>
              </div>
              <div className="stat-item">
                <span className="stat-item-label">Rate:</span>
                <span className="stat-item-value">
                  {stats.imageAttempts > 0 ? formatPercent(stats.imageModerationRate) : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          <div className="stats-section">
            <h4>🎥 Video Generation</h4>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-item-label">Attempts:</span>
                <span className="stat-item-value">{stats.videoAttempts}</span>
              </div>
              <div className="stat-item">
                <span className="stat-item-label">Moderated:</span>
                <span className="stat-item-value stat-danger-text">{stats.videoModerated}</span>
              </div>
              <div className="stat-item">
                <span className="stat-item-label">Rate:</span>
                <span className="stat-item-value">
                  {stats.videoAttempts > 0 ? formatPercent(stats.videoModerationRate) : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {stats.moderationRate > 0.3 && (
            <div className="moderation-warning">
              <strong>⚠️ High Moderation Rate Detected</strong>
              <p>
                {formatPercent(stats.moderationRate)} of your generations are being moderated.
                You've wasted {formatCost(stats.totalWasted)} on rejected content.
              </p>
              <p className="moderation-tip">
                💡 Tip: Try using more generic terms, avoid specific descriptions of people,
                and test with image generation (cheaper) before attempting video generation.
              </p>
            </div>
          )}

          <div className="moderation-actions">
            <button
              type="button"
              onClick={handleClear}
              className="btn-clear-history"
            >
              Clear History
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

