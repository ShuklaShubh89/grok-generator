import type { RiskAssessment } from "../lib/promptAnalysis";

interface ModerationConfidenceProps {
  assessment: RiskAssessment | null;
  analyzing: boolean;
}

export default function ModerationConfidence({ assessment, analyzing }: ModerationConfidenceProps) {
  if (analyzing) {
    return (
      <div className="moderation-confidence analyzing">
        <div className="confidence-header">
          <span className="confidence-icon">🔎</span>
          <span className="confidence-text">Reviewing prompt against your local generation history...</span>
        </div>
      </div>
    );
  }

  if (!assessment) {
    return null;
  }

  const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;
  const formatCost = (cost: number) => `$${cost.toFixed(2)}`;

  // Adjusted thresholds: Low < 25%, Medium 25-50%, High > 50%
  const getRiskLevel = () => {
    if (assessment.riskScore < 0.25) return { label: 'Low', color: 'success', icon: '✅', description: 'Safe to proceed' };
    if (assessment.riskScore < 0.5) return { label: 'Medium', color: 'warning', icon: '⚠️', description: 'Proceed with caution' };
    return { label: 'High', color: 'danger', icon: '🚨', description: 'High risk of moderation' };
  };

  const risk = getRiskLevel();

  return (
    <div className={`moderation-confidence risk-${risk.color}`}>
      <div className="confidence-header">
        <span className="confidence-icon">{risk.icon}</span>
        <span className="confidence-text">
          Moderation Risk: <strong>{risk.label}</strong> ({formatPercent(assessment.riskScore)})
          <span className="risk-description"> - {risk.description}</span>
        </span>
      </div>

      <div className="confidence-details">
        {/* Overall Confidence */}
        <div className="confidence-row">
          <span className="confidence-label">Overall Confidence:</span>
          <span className="confidence-value">{formatPercent(assessment.confidence)}</span>
        </div>

        {/* Estimated Waste */}
        {assessment.estimatedWaste > 0 && (
          <div className="confidence-row">
            <span className="confidence-label">Potential Waste if Moderated:</span>
            <span className="confidence-value warning-text">{formatCost(assessment.estimatedWaste)}</span>
          </div>
        )}

        {/* Historical Data */}
        {assessment.similarModerated.length > 0 && (
          <div className="confidence-history">
            <span className="history-label">📊 Similar Moderated Prompts ({assessment.similarModerated.length}):</span>
            <ul className="history-list">
              {assessment.similarModerated.slice(0, 2).map((similar, i) => (
                <li key={i}>
                  <span className="similarity-badge">{formatPercent(similar.similarity)} match</span>
                  "{similar.event.prompt.substring(0, 60)}{similar.event.prompt.length > 60 ? '...' : ''}"
                </li>
              ))}
            </ul>
          </div>
        )}

        {assessment.similarSuccessful.length > 0 && (
          <div className="confidence-history">
            <span className="history-label success">✅ Similar Successful Prompts ({assessment.similarSuccessful.length}):</span>
            <ul className="history-list">
              {assessment.similarSuccessful.slice(0, 2).map((similar, i) => (
                <li key={i}>
                  <span className="similarity-badge success">{formatPercent(similar.similarity)} match</span>
                  "{similar.event.prompt.substring(0, 60)}{similar.event.prompt.length > 60 ? '...' : ''}"
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Risky Words */}
        {assessment.riskyWords.length > 0 && (
          <div className="confidence-risky-words">
            <span className="risky-words-label">🔍 Risky Words Detected ({assessment.riskyWords.length}):</span>
            <div className="risky-words-tags">
              {assessment.riskyWords.map((word, i) => (
                <span key={i} className="risky-word-tag">{word}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
