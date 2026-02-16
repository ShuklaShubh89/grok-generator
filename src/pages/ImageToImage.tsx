import { useState, useCallback } from "react";
import ImageUpload from "../components/ImageUpload";
import CostEstimator from "../components/CostEstimator";
import AutoSaveSettings from "../components/AutoSaveSettings";
import ModerationStats from "../components/ModerationStats";
import ModerationWarning from "../components/ModerationWarning";
import ModerationConfidence from "../components/ModerationConfidence";
import { useAppState } from "../context/AppStateContext";
import type { RiskAssessment } from "../lib/promptAnalysis";

export default function ImageToImage() {
  const { state, updateImageToImageState, generateImages, analyzePrompt } = useAppState();
  const { preview, prompt, model, imageCount, resultUrls, loading, error } = state.imageToImage;

  const [localError, setLocalError] = useState<string | null>(null);
  const [warningAssessment, setWarningAssessment] = useState<RiskAssessment | null>(null);
  const [confidenceAssessment, setConfidenceAssessment] = useState<RiskAssessment | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const onFileSelect = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setLocalError("Please select an image file.");
      return;
    }
    setLocalError(null);
    updateImageToImageState({ resultUrls: [], error: null });
    const reader = new FileReader();
    reader.onload = () => updateImageToImageState({ preview: reader.result as string });
    reader.readAsDataURL(f);
  }, [updateImageToImageState]);

  const submit = useCallback(async () => {
    setAnalyzing(true);
    setConfidenceAssessment(null);

    await generateImages(async (assessment) => {
      setAnalyzing(false);
      setConfidenceAssessment(assessment);

      // Show warning modal and wait for user decision
      setWarningAssessment(assessment);
      return new Promise((resolve) => {
        // Store resolve function to be called by modal buttons
        (window as any).__moderationWarningResolve = resolve;
      });
    });

    setAnalyzing(false);
  }, [generateImages]);

  const handleWarningCancel = useCallback(() => {
    setWarningAssessment(null);
    if ((window as any).__moderationWarningResolve) {
      (window as any).__moderationWarningResolve(false);
      delete (window as any).__moderationWarningResolve;
    }
  }, []);

  const handleWarningProceed = useCallback(() => {
    setWarningAssessment(null);
    if ((window as any).__moderationWarningResolve) {
      (window as any).__moderationWarningResolve(true);
      delete (window as any).__moderationWarningResolve;
    }
  }, []);

  const handleAnalyzePrompt = useCallback(async () => {
    if (!prompt.trim()) {
      setLocalError("Please enter a prompt to analyze.");
      return;
    }

    setAnalyzing(true);
    setConfidenceAssessment(null);
    setLocalError(null);

    try {
      const costPerImage = model === "grok-imagine-image-pro" ? 0.07 : 0.02;
      const totalCost = costPerImage * imageCount;
      const assessment = await analyzePrompt(prompt.trim(), 'image', totalCost);
      setConfidenceAssessment(assessment);
    } catch (err) {
      setLocalError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnalyzing(false);
    }
  }, [prompt, model, imageCount, analyzePrompt]);

  const displayError = error || localError;

  return (
    <div className="page">
      <h1>Image to Image</h1>
      <p className="subtitle">Upload an image and describe how to edit it. The model returns new image(s).</p>

      {resultUrls.length > 0 && (
        <div className="result result-on-top">
          <h2>Result{resultUrls.length > 1 ? "s" : ""} ({resultUrls.length})</h2>
          <div className="result-grid">
            {resultUrls.map((url, idx) => (
              <div key={idx} className="result-grid-item">
                <img src={url} alt={`Generated ${idx + 1}`} className="result-img" />
              </div>
            ))}
          </div>
        </div>
      )}

      <AutoSaveSettings />
      <ModerationStats filterType="image" />

      <ModerationConfidence assessment={confidenceAssessment} analyzing={analyzing} />

      <div className="form">
        <label className="block">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => updateImageToImageState({ prompt: e.target.value })}
            placeholder="e.g. Change the sky to sunset and add birds"
            rows={3}
          />
        </label>

        <label className="block">
          <span>Model (Pro = higher quality, 3.5x cost)</span>
          <select value={model} onChange={(e) => updateImageToImageState({ model: e.target.value as typeof model })}>
            <option value="grok-imagine-image">Standard ($0.02/image) - Recommended</option>
            <option value="grok-imagine-image-pro">Pro ($0.07/image) - Premium quality</option>
          </select>
        </label>

        <label className="block">
          <span>Number of images to generate</span>
          <select value={imageCount} onChange={(e) => updateImageToImageState({ imageCount: Number(e.target.value) })}>
            <option value={1}>1 image</option>
            <option value={2}>2 images</option>
            <option value={3}>3 images</option>
            <option value={4}>4 images</option>
          </select>
        </label>

        <ImageUpload preview={preview} onFileSelect={onFileSelect} />

        <CostEstimator type="image" model={model} imageCount={imageCount} />

        <div className="button-group">
          <button
            type="button"
            onClick={handleAnalyzePrompt}
            disabled={analyzing || !prompt.trim()}
            className="btn-analyze"
          >
            {analyzing ? "Analyzing…" : "🔍 Analyze Prompt"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || !preview || !prompt.trim()}
            className="btn-generate"
          >
            {loading ? "Generating…" : `Generate ${imageCount} image${imageCount > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>

      {displayError && <p className="error">{displayError}</p>}

      {warningAssessment && (
        <ModerationWarning
          assessment={warningAssessment}
          type="image"
          onCancel={handleWarningCancel}
          onProceed={handleWarningProceed}
        />
      )}
    </div>
  );
}
