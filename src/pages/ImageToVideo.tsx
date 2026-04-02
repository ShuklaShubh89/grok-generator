import { useState, useCallback, useEffect, useRef } from "react";
import ImageUpload from "../components/ImageUpload";
import CostEstimator from "../components/CostEstimator";
import AutoSaveSettings from "../components/AutoSaveSettings";
import ModerationStats from "../components/ModerationStats";
import ModerationConfidence from "../components/ModerationConfidence";
import PromptRewriteCard from "../components/PromptRewriteCard";
import { useAppState } from "../context/AppStateContext";
import type { RiskAssessment } from "../lib/promptAnalysis";
import type { PromptRewriteResult } from "../lib/grokPromptRewrite";
import { runPreflightCheck, type PreflightResult } from "../lib/preflightCheck";
import { calculateVideoCost } from "../lib/pricing";
import { uploadPrivateVideoForExtension } from "../lib/s3VideoUpload";

const DURATION_MIN = 1;
const DURATION_MAX = 15;
const EDIT_INPUT_MAX_SECONDS = 8.7;
const EXTEND_INPUT_MIN_SECONDS = 2;
const EXTEND_INPUT_MAX_SECONDS = 15;
const EXTEND_DURATION_MIN = 2;
const EXTEND_DURATION_MAX = 10;

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Could not read the MP4 duration."));
        return;
      }
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not read the MP4 metadata."));
    };

    video.src = objectUrl;
  });
}

export default function ImageToVideo() {
  const { state, updateImageToVideoState, generateVideo, analyzePrompt, rewritePrompt } = useAppState();
  const { mode, preview, sourceVideoUrl, sourceVideoName, sourceVideoKey, prompt, duration, resolution, resultUrl, sourceUrl, loading, error, diagnostics } = state.imageToVideo;

  const [localError, setLocalError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [uploadingSourceVideo, setUploadingSourceVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [localSourceVideoDuration, setLocalSourceVideoDuration] = useState<number | null>(null);
  const [reusedCachedUpload, setReusedCachedUpload] = useState(false);
  const [confidenceAssessment, setConfidenceAssessment] = useState<RiskAssessment | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteResult, setRewriteResult] = useState<PromptRewriteResult | null>(null);
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
    setReusedCachedUpload(false);
    updateImageToVideoState({ resultUrl: null, error: null, sourceVideoUrl: "", sourceVideoKey: null });
    const reader = new FileReader();
    reader.onload = () => updateImageToVideoState({ preview: reader.result as string });
    reader.readAsDataURL(f);
  }, [updateImageToVideoState]);

  const onVideoSelect = useCallback(async (f: File) => {
    if (!(f.type === "video/mp4" || f.name.toLowerCase().endsWith(".mp4"))) {
      setLocalError("Please select an MP4 file.");
      return;
    }

    let durationSeconds: number;
    try {
      durationSeconds = await readVideoDuration(f);
    } catch (err) {
      setLocalError(`Video upload failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const minInputSeconds = mode === "extend" ? EXTEND_INPUT_MIN_SECONDS : 0;
    const maxInputSeconds = mode === "extend" ? EXTEND_INPUT_MAX_SECONDS : EDIT_INPUT_MAX_SECONDS;

    if (durationSeconds < minInputSeconds || durationSeconds > maxInputSeconds) {
      setLocalError(
        mode === "extend"
          ? `Please select an MP4 between ${EXTEND_INPUT_MIN_SECONDS} and ${EXTEND_INPUT_MAX_SECONDS} seconds for xAI video extensions. This file is ${durationSeconds.toFixed(1)} seconds long.`
          : `Please select an MP4 up to ${EDIT_INPUT_MAX_SECONDS} seconds for xAI video edits. This file is ${durationSeconds.toFixed(1)} seconds long.`
      );
      return;
    }

    if (uploadProgressTimer.current !== null) {
      window.clearTimeout(uploadProgressTimer.current);
      uploadProgressTimer.current = null;
    }

    setUploadingSourceVideo(true);
    setUploadProgress(0);
    setLocalSourceVideoDuration(durationSeconds);
    setReusedCachedUpload(false);
    setLocalError(null);
    updateImageToVideoState({
      resultUrl: null,
      sourceUrl: null,
      error: null,
      sourceVideoUrl: "",
      sourceVideoName: f.name,
      sourceVideoKey: null,
    });

    try {
      const uploaded = await uploadPrivateVideoForExtension(f, (percent) => setUploadProgress(percent));
      setReusedCachedUpload(uploaded.cached);
      updateImageToVideoState({
        sourceVideoUrl: uploaded.sourceVideoUrl,
        sourceVideoName: uploaded.sourceVideoName,
        sourceVideoKey: uploaded.key,
      });
      if (!uploaded.cached) {
        setUploadProgress(100);
        uploadProgressTimer.current = window.setTimeout(() => {
          setUploadProgress(null);
          uploadProgressTimer.current = null;
        }, 1200);
      } else {
        setUploadProgress(null);
      }
    } catch (err) {
      updateImageToVideoState({
        sourceVideoUrl: "",
        sourceVideoName: null,
        sourceVideoKey: null,
      });
      setUploadProgress(null);
      setLocalSourceVideoDuration(null);
      setReusedCachedUpload(false);
      setLocalError(`Video upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadingSourceVideo(false);
    }
  }, [mode, updateImageToVideoState]);

  const handleModeChange = useCallback((nextMode: "generate" | "edit" | "extend") => {
    updateImageToVideoState({
      mode: nextMode,
      error: null,
      resultUrl: null,
      sourceUrl: null,
      sourceVideoName: nextMode === "generate" ? null : sourceVideoName,
      sourceVideoKey: nextMode === "generate" ? null : sourceVideoKey,
      ...(nextMode === "extend" ? { duration: Math.min(EXTEND_DURATION_MAX, Math.max(EXTEND_DURATION_MIN, duration || 6)) } : {}),
      ...(nextMode === "edit" ? { duration: Math.min(EDIT_INPUT_MAX_SECONDS, Math.max(1, duration || 6)) } : {}),
      ...(nextMode === "generate" && sourceVideoUrl ? { sourceVideoUrl: "" } : {}),
      ...((nextMode === "edit" || nextMode === "extend") && sourceUrl && !sourceVideoUrl ? { sourceVideoUrl: sourceUrl } : {}),
    });
    setLocalError(null);
  }, [duration, sourceUrl, sourceVideoKey, sourceVideoName, sourceVideoUrl, updateImageToVideoState]);

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

  const handleRewritePrompt = useCallback(async () => {
    if (!prompt.trim()) {
      setLocalError("Please enter a prompt to rewrite.");
      return;
    }

    setRewriting(true);
    setRewriteResult(null);
    setLocalError(null);

    try {
      const result = await rewritePrompt(prompt.trim(), "video");
      setRewriteResult(result);
    } catch (err) {
      setLocalError(`Rewrite failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRewriting(false);
    }
  }, [prompt, rewritePrompt]);

  const displayError = error || localError;

  return (
    <div className="page">
      <h1>Image to Video</h1>
      <p className="subtitle">
        {mode === "generate"
          ? "Upload an image and describe the motion. The model returns a short video."
          : mode === "edit"
            ? "Provide a source video URL and describe the edits. xAI keeps the source video's duration, aspect ratio, and resolution."
            : "Provide a source video URL and describe how to continue it. xAI extends the clip by a few new seconds."}
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
                    updateImageToVideoState({ sourceVideoUrl: sourceUrl, sourceVideoKey: null });
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
      <PromptRewriteCard
        result={rewriteResult}
        loading={rewriting}
        onApply={() => {
          if (!rewriteResult) return;
          updateImageToVideoState({ prompt: rewriteResult.rewrittenPrompt });
          setRewriteResult(null);
        }}
        onDismiss={() => setRewriteResult(null)}
      />

      <div className="form">
        <label className="block">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as "generate" | "edit" | "extend")}
          >
            <option value="generate">Generate video from image</option>
            <option value="edit">Edit existing video</option>
            <option value="extend">Extend existing video</option>
          </select>
        </label>

        {(mode === "edit" || mode === "extend") && (
          <label className="block">
            <span>Source video URL</span>
            <input
              type="url"
              value={sourceVideoUrl}
              onChange={(e) => {
                updateImageToVideoState({ sourceVideoUrl: e.target.value, sourceVideoName: null, sourceVideoKey: null });
                setLocalSourceVideoDuration(null);
                setReusedCachedUpload(false);
              }}
              placeholder="Paste a public MP4 URL or an xAI video URL"
            />
            <span className="cost-detail-note">
              {mode === "edit"
                ? `xAI accepts a source video URL for edits. You can paste a public MP4 link or upload a local MP4 below. Local MP4s must be no longer than ${EDIT_INPUT_MAX_SECONDS} seconds.`
                : `xAI accepts a source video URL for extensions. You can paste a public MP4 link or upload a local MP4 below. Local MP4s must be between ${EXTEND_INPUT_MIN_SECONDS} and ${EXTEND_INPUT_MAX_SECONDS} seconds.`}
            </span>
            <span className="cost-detail-note">
              Private uploads require this app to be reachable on a public URL so xAI can fetch the proxy endpoint.
            </span>
          </label>
        )}

        {(mode === "edit" || mode === "extend") && (
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
              {reusedCachedUpload && !uploadingSourceVideo && (
                <span className="upload-private-badge">Reused cached S3 URL</span>
              )}
              {sourceVideoName && !uploadingSourceVideo && (
                <span className="upload-selected-name">{sourceVideoName}</span>
              )}
              {localSourceVideoDuration !== null && !uploadingSourceVideo && (
                <span className="upload-selected-name">
                  {localSourceVideoDuration.toFixed(1)}s checked
                </span>
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
                  ? reusedCachedUpload
                    ? `Selected file: ${sourceVideoName} (reused cached private S3 URL)`
                    : `Selected file: ${sourceVideoName} (private S3 upload)`
                  : "The file is uploaded privately to S3 and then passed to xAI through a presigned URL."}
            </span>
            {localSourceVideoDuration !== null && !uploadingSourceVideo && (
              <span className="cost-detail-note">
                Duration checked in browser. Codec compatibility still depends on the MP4 encoding.
              </span>
            )}
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
              : mode === "extend"
                ? `Extension length: ${duration} s`
                : "Edited video length: same as source"}
          </span>
          {mode === "edit" ? (
            <span className="cost-detail-note">
              xAI video edits keep the original clip duration and do not support a custom duration.
            </span>
          ) : (
            <input
              type="range"
              className="slider"
              min={mode === "generate" ? DURATION_MIN : EXTEND_DURATION_MIN}
              max={mode === "generate" ? DURATION_MAX : EXTEND_DURATION_MAX}
              value={duration}
              onChange={(e) => updateImageToVideoState({ duration: Number(e.target.value) })}
            />
          )}
        </label>

        <label className="block">
          <span>{mode === "generate" ? "Resolution (lower = cheaper)" : "Source video resolution (detected from upload or URL)"}</span>
          <select
            value={resolution}
            onChange={(e) => updateImageToVideoState({ resolution: e.target.value as "480p" | "720p" })}
            disabled={mode !== "generate"}
          >
            <option value="480p">480p (854x480) - Recommended (lowest cost)</option>
            <option value="720p">720p (1280x720) - Higher quality</option>
          </select>
          {mode !== "generate" && (
            <span className="cost-detail-note">
              {mode === "edit"
                ? "xAI video edits keep the source video's own resolution and aspect ratio."
                : "xAI video extensions use the source video's own resolution and aspect ratio. The slider above controls how many new seconds to add."}
            </span>
          )}
        </label>

        {mode === "generate" && <ImageUpload preview={preview} onFileSelect={onFileSelect} />}

        <CostEstimator type="video" videoMode={mode} duration={duration} resolution={resolution} />

        <div className="button-group">
          <button
            type="button"
            onClick={handleRewritePrompt}
            disabled={rewriting || analyzing || uploadingSourceVideo || !prompt.trim()}
            className="btn-analyze"
          >
            {rewriting ? "Rewriting…" : "✍️ Rewrite Prompt"}
          </button>
          <button
            type="button"
            onClick={handleAnalyzePrompt}
            disabled={analyzing || rewriting || uploadingSourceVideo || !prompt.trim()}
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
            {loading ? "Generating video…" : mode === "generate" ? "Generate video" : mode === "edit" ? "Edit video" : "Extend video"}
          </button>
        </div>

        <div className="button-help-text">
          {mode === "generate" ? (
            <p>💡 <strong>Preflight Check:</strong> Test your prompt with a 1s video ($0.052) before committing to the full generation. Saves money if your prompt gets moderated!</p>
          ) : mode === "edit" ? (
            <p>💡 <strong>Video edit:</strong> xAI keeps the source video's duration, aspect ratio, and resolution. Input MP4s must be at most 8.7 seconds.</p>
          ) : (
            <p>💡 <strong>Video extension:</strong> xAI uses the source video's own aspect ratio and resolution. The slider controls the extension length, which must stay between 2 and 10 seconds, and the input video must be 2 to 15 seconds.</p>
          )}
        </div>
      </div>

      {displayError && <p className="error">{displayError}</p>}
      {diagnostics && (
        <details className="diagnostics">
          <summary>Show xAI error details</summary>
          <pre>{diagnostics}</pre>
        </details>
      )}
    </div>
  );
}
