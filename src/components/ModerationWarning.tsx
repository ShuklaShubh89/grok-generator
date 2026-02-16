import type { RiskAssessment } from "../lib/promptAnalysis";
import { calculatePreflightCost } from "../lib/pricing";

interface ModerationWarningProps {
  assessment: RiskAssessment;
  type: 'image' | 'video';
  onCancel: () => void;
  onProceed: () => void;
  onPreflight?: () => void; // Optional preflight check for videos
}

export default function ModerationWarning({
  assessment,
  type,
  onCancel,
  onProceed,
  onPreflight,
}: ModerationWarningProps) {
  const { riskScore, confidence, similarModerated, similarSuccessful, riskyWords, suggestions, estimatedWaste } = assessment;

  const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;
  const formatCost = (cost: number) => `$${cost.toFixed(2)}`;

  const getRiskLevel = () => {
    if (riskScore < 0.3) return { label: 'Low', color: 'success' };
    if (riskScore < 0.6) return { label: 'Medium', color: 'warning' };
    return { label: 'High', color: 'danger' };
  };

  const risk = getRiskLevel();

  return (
    <div className="modal-overlay">
      <div className="modal-content moderation-warning-modal">
        <div className="modal-header">
          <h2>⚠️ Moderation Risk Assessment</h2>
        </div>

        <div className="modal-body">
          {/* Risk Score */}
          <div className={`risk-score-card risk-${risk.color}`}>
            <div className="risk-score-label">Risk Level: {risk.label}</div>
            <div className="risk-score-value">{formatPercent(riskScore)}</div>
            <div className="risk-score-subtitle">
              Confidence: {formatPercent(confidence)}
              {confidence < 0.3 && " (Limited data)"}
            </div>
          </div>

          {/* Grok AI Analysis */}
          {assessment.grokAnalysis && assessment.grokAnalysis.confidence > 0 && (
            <div className={`warning-section grok-analysis ${assessment.grokAnalysis.safe ? 'grok-safe' : 'grok-unsafe'}`}>
              <strong>🤖 Grok AI Analysis:</strong>
              <p className="grok-reasoning">{assessment.grokAnalysis.reasoning}</p>
              {assessment.grokAnalysis.issues.length > 0 && (
                <div className="grok-issues">
                  <strong>Issues found:</strong>
                  <ul>
                    {assessment.grokAnalysis.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grok-confidence">
                AI Confidence: {formatPercent(assessment.grokAnalysis.confidence)}
              </div>
            </div>
          )}

          {/* Estimated Waste */}
          {estimatedWaste > 0.01 && (
            <div className="warning-section">
              <strong>💸 Estimated Waste:</strong> {formatCost(estimatedWaste)}
            </div>
          )}

          {/* Risky Words */}
          {riskyWords.length > 0 && (
            <div className="warning-section">
              <strong>🚨 Risky Words Detected:</strong>
              <div className="risky-words">
                {riskyWords.map(word => (
                  <span key={word} className="risky-word">{word}</span>
                ))}
              </div>
              <p className="warning-hint">
                These words frequently appear in your moderated {type} generations.
              </p>
            </div>
          )}

          {/* Similar Moderated Prompts */}
          {similarModerated.length > 0 && (
            <div className="warning-section">
              <strong>❌ Similar Moderated Prompts:</strong>
              <ul className="similar-prompts">
                {similarModerated.slice(0, 3).map((s, i) => (
                  <li key={i}>
                    <span className="similarity-badge">{formatPercent(s.similarity)} match</span>
                    "{s.event.prompt}"
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Similar Successful Prompts */}
          {similarSuccessful.length > 0 && (
            <div className="warning-section">
              <strong>✅ Similar Successful Prompts:</strong>
              <ul className="similar-prompts">
                {similarSuccessful.slice(0, 3).map((s, i) => (
                  <li key={i}>
                    <span className="similarity-badge success">{formatPercent(s.similarity)} match</span>
                    "{s.event.prompt}"
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="warning-section">
              <strong>💡 Suggestions to Reduce Risk:</strong>
              <ul className="suggestions-list">
                {suggestions.map((suggestion, i) => (
                  <li key={i}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Low Data Warning */}
          {confidence < 0.3 && (
            <div className="warning-section warning-info">
              <strong>ℹ️ Limited Historical Data</strong>
              <p>
                Not enough similar prompts in your history to make a confident prediction.
                This assessment is based on limited data.
              </p>
            </div>
          )}

          {/* Preflight Check Recommendation */}
          {type === 'video' && onPreflight && riskScore > 0.3 && (
            <div className="warning-section preflight-recommendation">
              <strong>💡 Recommended: Run Preflight Check</strong>
              <p>
                Test this prompt with a quick 1-second 480p video (${calculatePreflightCost().toFixed(3)}) before committing
                to your full generation. If it passes moderation, proceed with confidence!
              </p>
              <p className="preflight-savings">
                ✅ Catches moderation early<br/>
                ✅ Same cost as full video<br/>
                ✅ Confirms prompt safety before full render
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            onClick={onCancel}
            className="btn-modal btn-cancel"
          >
            Cancel
          </button>
          {type === 'video' && onPreflight && riskScore > 0.3 && (
            <button
              type="button"
              onClick={onPreflight}
              className="btn-modal btn-preflight"
            >
              🧪 Run Preflight Check
            </button>
          )}
          <button
            type="button"
            onClick={onProceed}
            className="btn-modal btn-proceed"
          >
            Generate Anyway
          </button>
        </div>
      </div>
    </div>
  );
}

