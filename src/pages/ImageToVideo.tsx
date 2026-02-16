import { useState, useCallback } from "react";
import ImageUpload from "../components/ImageUpload";
import CostEstimator from "../components/CostEstimator";
import AutoSaveSettings from "../components/AutoSaveSettings";
import { useAppState } from "../context/AppStateContext";

const DURATION_MIN = 1;
const DURATION_MAX = 15;

export default function ImageToVideo() {
  const { state, updateImageToVideoState, generateVideo } = useAppState();
  const { preview, prompt, duration, resolution, resultUrl, loading, error } = state.imageToVideo;

  const [localError, setLocalError] = useState<string | null>(null);

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
    await generateVideo();
  }, [generateVideo]);

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

      <AutoSaveSettings />

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
            onChange={(e) => updateImageToVideoState({ resolution: e.target.value as "360p" | "480p" | "720p" })}
          >
            <option value="360p">360p (640x360) - Lowest cost</option>
            <option value="480p">480p (854x480) - Recommended</option>
            <option value="720p">720p (1280x720) - Higher cost</option>
          </select>
        </label>

        <ImageUpload preview={preview} onFileSelect={onFileSelect} />

        <CostEstimator type="video" duration={duration} resolution={resolution} />

        <button type="button" onClick={submit} disabled={loading || !preview || !prompt.trim()}>
          {loading ? "Generating video…" : "Generate video"}
        </button>
      </div>

      {displayError && <p className="error">{displayError}</p>}
    </div>
  );
}
