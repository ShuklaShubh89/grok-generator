import { useState, useCallback } from "react";
import ImageUpload from "../components/ImageUpload";
import CostEstimator from "../components/CostEstimator";
import AutoSaveSettings from "../components/AutoSaveSettings";
import ModerationStats from "../components/ModerationStats";
import ModerationWarning from "../components/ModerationWarning";
import ModerationConfidence from "../components/ModerationConfidence";
import { useAppState } from "../context/AppStateContext";
import type { RiskAssessment } from "../lib/promptAnalysis";
import { runPreflightCheck, type PreflightResult } from "../lib/preflightCheck";
import { calculateVideoCost } from "../lib/pricing";

const DURATION_MIN = 1;
const DURATION_MAX = 15;

export default function ImageToVideo() {
  const { state, updateImageToVideoState, generateVideo, analyzePrompt } = useAppState();
  const { preview, prompt, duration, resolution, resultUrl, loading, error } = state.imageToVideo;

  const [localError, setLocalError] = useState<string | null>(null);
  const [warningAssessment, setWarningAssessment] = useState<RiskAssessment | null>(null);
  const [confidenceAssessment, setConfidenceAssessment] = useState<RiskAssessment | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);

  const onFileSelect = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setLocalError("Please select an image file.");
      return;
    }
    setLocalError(null);
    updateImageToVideoState({ resultUrl: null, error: null });
    const reader = new FileReader();
    reader.onload = () => updateImageToVideoState({ preview: reader.result as string });
    reader.readAsDataURL(f);
  }, [updateImageToVideoState]);

  const submit = useCallback(async () => {
    setAnalyzing(true);
    setConfidenceAssessment(null);

    await generateVideo(async (assessment) => {
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
  }, [generateVideo]);

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

  const handlePreflight = useCallback(async () => {
    if (!preview || !prompt.trim()) return;

    setWarningAssessment(null); // Close warning modal
    setPreflightRunning(true);
    setPreflightResult(null);
    setLocalError(null);

    try {
      const result = await runPreflightCheck(prompt.trim(), preview);
      setPreflightResult(result);

      if (result.passed) {
        // Preflight passed! Ask if user wants to proceed with full generation
        const shouldProceed = confirm(
          "✅ Preflight check passed! Your prompt is safe.\n\n" +
          "Would you like to proceed with the full video generation?"
        );

        if (shouldProceed && (window as any).__moderationWarningResolve) {
          (window as any).__moderationWarningResolve(true);
          delete (window as any).__moderationWarningResolve;
        } else if ((window as any).__moderationWarningResolve) {
          (window as any).__moderationWarningResolve(false);
          delete (window as any).__moderationWarningResolve;
        }
      } else {
        // Preflight failed - moderation caught
        setLocalError(
          `❌ Preflight check failed: ${result.error}\n\n` +
          "Your prompt was moderated. Please modify it and try again."
        );
        if ((window as any).__moderationWarningResolve) {
          (window as any).__moderationWarningResolve(false);
          delete (window as any).__moderationWarningResolve;
        }
      }
    } catch (err) {
      setLocalError(`Preflight check error: ${err instanceof Error ? err.message : String(err)}`);
      if ((window as any).__moderationWarningResolve) {
        (window as any).__moderationWarningResolve(false);
        delete (window as any).__moderationWarningResolve;
      }
    } finally {
      setPreflightRunning(false);
    }
  }, [preview, prompt]);

  const handleAnalyzePrompt = useCallback(async () => {
    if (!prompt.trim()) {
      setLocalError("Please enter a prompt to analyze.");
      return;
    }

    setAnalyzing(true);
    setConfidenceAssessment(null);
    setLocalError(null);

    try {
      const videoCost = calculateVideoCost(duration, resolution);
      const assessment = await analyzePrompt(prompt.trim(), 'video', videoCost);
      setConfidenceAssessment(assessment);
    } catch (err) {
      setLocalError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnalyzing(false);
    }
  }, [prompt, duration, resolution, analyzePrompt]);

  const displayError = error || localError;

  return (
    <div className="page">
      <h1>Image to Video</h1>
      <p className="subtitle">Upload an image and describe the motion. The model returns a short video.</p>

      {resultUrl && (
        <div className="result result-on-top">
          <h2>Result</h2>
          <video src={resultUrl} controls className="result-video" />
        </div>
      )}
      {loading && !resultUrl && (
        <p className="status">Video is being generated. This may take a few minutes.</p>
      )}
      {preflightRunning && (
        <p className="status">🧪 Running preflight check (1s 480p test)...</p>
      )}
      {preflightResult && preflightResult.passed && (
        <div className="preflight-success">
          <p>✅ Preflight check passed! Your prompt is safe for video generation.</p>
        </div>
      )}

      <AutoSaveSettings />
      <ModerationStats filterType="video" />

      <ModerationConfidence assessment={confidenceAssessment} analyzing={analyzing} />

      <div className="form">
        <label className="block">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => updateImageToVideoState({ prompt: e.target.value })}
            placeholder="e.g. Animate the clouds drifting and trees swaying gently"
            rows={3}
          />
        </label>

        <label className="block">
          <span>Video length: {duration} s</span>
          <input
            type="range"
            className="slider"
            min={DURATION_MIN}
            max={DURATION_MAX}
            value={duration}
            onChange={(e) => updateImageToVideoState({ duration: Number(e.target.value) })}
          />
        </label>

        <label className="block">
          <span>Resolution (lower = cheaper)</span>
          <select
            value={resolution}
            onChange={(e) => updateImageToVideoState({ resolution: e.target.value as "480p" | "720p" })}
          >
            <option value="480p">480p (854x480) - Recommended (lowest cost)</option>
            <option value="720p">720p (1280x720) - Higher quality</option>
          </select>
        </label>

        <ImageUpload preview={preview} onFileSelect={onFileSelect} />

        <CostEstimator type="video" duration={duration} resolution={resolution} />

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
            {loading ? "Generating video…" : "Generate video"}
          </button>
        </div>
      </div>

      {displayError && <p className="error">{displayError}</p>}

      {warningAssessment && (
        <ModerationWarning
          assessment={warningAssessment}
          type="video"
          onCancel={handleWarningCancel}
          onProceed={handleWarningProceed}
          onPreflight={handlePreflight}
        />
      )}
    </div>
  );
}
