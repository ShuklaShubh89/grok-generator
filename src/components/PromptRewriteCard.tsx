import type { PromptRewriteResult } from "../lib/grokPromptRewrite";

interface PromptRewriteCardProps {
  result: PromptRewriteResult | null;
  loading: boolean;
  onApply: () => void;
  onDismiss: () => void;
}

export default function PromptRewriteCard({
  result,
  loading,
  onApply,
  onDismiss,
}: PromptRewriteCardProps) {
  if (loading) {
    return (
      <div className="prompt-rewrite-card">
        <div className="prompt-rewrite-header">
          <strong>Rewrite Suggestion</strong>
          <span className="prompt-rewrite-status">Using Grok text model...</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="prompt-rewrite-card">
      <div className="prompt-rewrite-header">
        <strong>Rewrite Suggestion</strong>
        <span className="prompt-rewrite-status">Advisory only</span>
      </div>
      <p className="prompt-rewrite-rationale">{result.rationale}</p>
      <textarea className="prompt-rewrite-output" readOnly rows={4} value={result.rewrittenPrompt} />
      {result.changes.length > 0 && (
        <ul className="prompt-rewrite-changes">
          {result.changes.map((change, index) => (
            <li key={index}>{change}</li>
          ))}
        </ul>
      )}
      <div className="button-group">
        <button type="button" className="btn-analyze" onClick={onApply}>
          Apply Rewrite
        </button>
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
