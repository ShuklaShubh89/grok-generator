import { useState, useCallback, useEffect, useRef } from "react";
import ImageUpload from "../components/ImageUpload";
import CostEstimator from "../components/CostEstimator";
import AutoSaveSettings from "../components/AutoSaveSettings";
import ModerationStats from "../components/ModerationStats";
import ModerationConfidence from "../components/ModerationConfidence";
import { useAppState } from "../context/AppStateContext";
import type { RiskAssessment } from "../lib/promptAnalysis";
import { runPreflightCheck, type PreflightResult } from "../lib/preflightCheck";
import { calculateVideoCost } from "../lib/pricing";
import { uploadPrivateVideoForExtension } from "../lib/s3VideoUpload";

const DURATION_MIN = 1;
const DURATION_MAX = 15;

export default function ImageToVideo() {
  const { state, updateImageToVideoState, generateVideo, analyzePrompt } = useAppState();
  const { mode, preview, sourceVideoUrl, sourceVideoName, prompt, duration, resolution, resultUrl, sourceUrl, loading, error } = state.imageToVideo;

  const [localError, setLocalError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [uploadingSourceVideo, setUploadingSourceVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confidenceAssessment, setConfidenceAssessment] = useState<RiskAssessment | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const uploadProgressTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (uploadProgressTimer.current !== null) {
        window.clearTimeout(uploadProgressTimer.current);
      }
    };
  }, []);

  const onFileSelect = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setLocalError("Please select an image file.");
      return;
    }
    setLocalError(null);
    updateImageToVideoState({ resultUrl: null, error: null, sourceVideoUrl: "" });
    const reader = new FileReader();
    reader.onload = () => updateImageToVideoState({ preview: reader.result as string });
    reader.readAsDataURL(f);
  }, [updateImageToVideoState]);

  const onVideoSelect = useCallback(async (f: File) => {
    if (!(f.type === "video/mp4" || f.name.toLowerCase().endsWith(".mp4"))) {
      setLocalError("Please select an MP4 file.");
      return;
    }

    if (uploadProgressTimer.current !== null) {
      window.clearTimeout(uploadProgressTimer.current);
      uploadProgressTimer.current = null;
    }

    setUploadingSourceVideo(true);
    setUploadProgress(0);
    setLocalError(null);
    updateImageToVideoState({
      resultUrl: null,
      sourceUrl: null,
      error: null,
      sourceVideoUrl: "",
      sourceVideoName: f.name,
    });

    try {
      const uploaded = await uploadPrivateVideoForExtension(f, (percent) => setUploadProgress(percent));
      updateImageToVideoState({
        sourceVideoUrl: uploaded.sourceVideoUrl,
        sourceVideoName: uploaded.sourceVideoName,
      });
      setUploadProgress(100);
      uploadProgressTimer.current = window.setTimeout(() => {
        setUploadProgress(null);
        uploadProgressTimer.current = null;
      }, 1200);
    } catch (err) {
      updateImageToVideoState({
        sourceVideoUrl: "",
        sourceVideoName: null,
      });
      setUploadProgress(null);
      setLocalError(`Video upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadingSourceVideo(false);
    }
  }, [updateImageToVideoState]);

  const handleModeChange = useCallback((nextMode: "generate" | "extend") => {
    updateImageToVideoState({
      mode: nextMode,
      error: null,
      resultUrl: null,
      sourceUrl: null,
      sourceVideoName: nextMode === "generate" ? null : sourceVideoName,
      ...(nextMode === "generate" && sourceVideoUrl ? { sourceVideoUrl: "" } : {}),
      ...(nextMode === "extend" && sourceUrl && !sourceVideoUrl ? { sourceVideoUrl: sourceUrl } : {}),
    });
    setLocalError(null);
  }, [sourceUrl, sourceVideoName, sourceVideoUrl, updateImageToVideoState]);

  const submit = useCallback(async () => {
    await generateVideo();
  }, [generateVideo]);

  // Manual preflight check (not from warning modal)
  const handleManualPreflight = useCallback(async () => {
    if (!preview || !prompt.trim()) {
      setLocalError("Please upload an image and enter a prompt first.");
      return;
    }

    setPreflightRunning(true);
    setPreflightResult(null);
    setLocalError(null);

    try {
      const result = await runPreflightCheck(prompt.trim(), preview);
      setPreflightResult(result);

      if (!result.passed) {
        // Preflight failed - moderation caught
        setLocalError(
          `❌ Preflight check failed: ${result.error}\n\n` +
          "Your prompt was moderated. Please modify it and try again."
        );
      }
      // If passed, the success message will show automatically via preflightResult state
    } catch (err) {
      setLocalError(`Preflight check error: ${err instanceof Error ? err.message : String(err)}`);
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
      <p className="subtitle">
        {mode === "generate"
          ? "Upload an image and describe the motion. The model returns a short video."
          : "Provide a source video URL and describe the edits. xAI keeps the source video's timing and resolution."}
      </p>

      {resultUrl && (
        <div className="result result-on-top">
          <h2>Result</h2>
          <video src={resultUrl} controls className="result-video" />
          {sourceUrl && (
            <div className="button-group">
              <button
                type="button"
                className="btn-imagine-link"
                onClick={() => {
                  navigator.clipboard.writeText(sourceUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
              >
                {copiedLink ? "✅ Copied!" : "🔗 Copy Imagine Link"}
              </button>
              {mode === "generate" && (
                <button
                  type="button"
                  className="btn-preflight"
                  onClick={() => {
                    handleModeChange("extend");
                    updateImageToVideoState({ sourceVideoUrl: sourceUrl });
                  }}
                >
                  ↗ Use this video to extend
                </button>
              )}
            </div>
          )}
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
          <span>Mode</span>
          <select
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as "generate" | "extend")}
          >
            <option value="generate">Generate video from image</option>
            <option value="extend">Extend / edit existing video</option>
          </select>
        </label>

        {mode === "extend" && (
          <label className="block">
            <span>Source video URL</span>
            <input
              type="url"
              value={sourceVideoUrl}
              onChange={(e) => updateImageToVideoState({ sourceVideoUrl: e.target.value, sourceVideoName: null })}
              placeholder="Paste a public MP4 URL or an xAI video URL"
            />
            <span className="cost-detail-note">
              xAI accepts a source video URL for edits. You can paste a public MP4 link or upload a local MP4 below.
            </span>
          </label>
        )}

        {mode === "extend" && (
          <label className="block">
            <span>Upload local MP4</span>
            <input
              type="file"
              accept="video/mp4"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onVideoSelect(f);
                e.target.value = "";
              }}
              disabled={uploadingSourceVideo}
            />
            <div className="upload-badge-row">
              <span className="upload-private-badge">Private S3 upload</span>
              {sourceVideoName && !uploadingSourceVideo && (
                <span className="upload-selected-name">{sourceVideoName}</span>
              )}
            </div>
            {uploadProgress !== null && (
              <div className="upload-progress" aria-live="polite">
                <div className="upload-progress-track" aria-hidden="true">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
                  />
                </div>
                <span className="upload-progress-text">
                  {uploadingSourceVideo ? `Uploading ${uploadProgress}%` : `Uploaded ${uploadProgress}%`}
                </span>
              </div>
            )}
            <span className="cost-detail-note">
              {uploadingSourceVideo
                ? "Uploading privately to S3..."
                : sourceVideoName
                  ? `Selected file: ${sourceVideoName} (private S3 upload)`
                  : "The file is uploaded privately to S3 and then passed to xAI through a presigned URL."}
            </span>
          </label>
        )}

        <label className="block">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => updateImageToVideoState({ prompt: e.target.value })}
            placeholder={mode === "generate"
              ? "e.g. Animate the clouds drifting and trees swaying gently"
              : "e.g. Add a subtle zoom, increase the brightness, and keep the motion smooth"}
            rows={3}
          />
        </label>

        <label className="block">
          <span>
            {mode === "generate"
              ? `Video length: ${duration} s`
              : `Estimated source video length: ${duration} s (for cost estimate only)`}
          </span>
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
          <span>{mode === "generate" ? "Resolution (lower = cheaper)" : "Estimated source video resolution (for cost estimate only)"}</span>
          <select
            value={resolution}
            onChange={(e) => updateImageToVideoState({ resolution: e.target.value as "480p" | "720p" })}
          >
            <option value="480p">480p (854x480) - Recommended (lowest cost)</option>
            <option value="720p">720p (1280x720) - Higher quality</option>
          </select>
          {mode === "extend" && (
            <span className="cost-detail-note">
              xAI ignores custom duration, aspect ratio, and resolution for video edits, so these values are only used for estimates.
            </span>
          )}
        </label>

        {mode === "generate" && <ImageUpload preview={preview} onFileSelect={onFileSelect} />}

        <CostEstimator type="video" videoMode={mode} duration={duration} resolution={resolution} />

        <div className="button-group">
          <button
            type="button"
            onClick={handleAnalyzePrompt}
            disabled={analyzing || uploadingSourceVideo || !prompt.trim()}
            className="btn-analyze"
          >
            {analyzing ? "Analyzing…" : "🔍 Analyze Prompt"}
          </button>
          <button
            type="button"
            onClick={handleManualPreflight}
            disabled={preflightRunning || uploadingSourceVideo || mode !== "generate" || !preview || !prompt.trim()}
            className="btn-preflight"
            title={
              mode === "generate"
                ? "Test your prompt with a quick 1s 480p video ($0.052) to catch moderation early"
                : "Preflight is only available for image-to-video generation"
            }
          >
            {preflightRunning ? "Running preflight…" : "🧪 Preflight Check"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || uploadingSourceVideo || (mode === "generate" ? !preview : !sourceVideoUrl.trim()) || !prompt.trim()}
            className="btn-generate"
          >
            {loading ? "Generating video…" : mode === "generate" ? "Generate video" : "Extend video"}
          </button>
        </div>

        <div className="button-help-text">
          {mode === "generate" ? (
            <p>💡 <strong>Preflight Check:</strong> Test your prompt with a 1s video ($0.052) before committing to the full generation. Saves money if your prompt gets moderated!</p>
          ) : (
            <p>💡 <strong>Video extension:</strong> xAI uses the source video's own duration, aspect ratio, and resolution for edits. The sliders here are only used to estimate cost.</p>
          )}
        </div>
      </div>

      {displayError && <p className="error">{displayError}</p>}
    </div>
  );
}
