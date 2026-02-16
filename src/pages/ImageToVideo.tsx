import { useState, useCallback } from "react";
import { imageToVideo } from "../lib/grokApi";
import ImageUpload from "../components/ImageUpload";
import { addToHistory, createThumbnail } from "../lib/history";

const DURATION_MIN = 1;
const DURATION_MAX = 15;
const DURATION_DEFAULT = 3;

export default function ImageToVideo() {
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(DURATION_DEFAULT);
  const [resolution, setResolution] = useState<"360p" | "480p" | "720p">("480p");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFileSelect = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    setError(null);
    setResultUrl(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  }, []);

  const submit = useCallback(async () => {
    if (!preview || !prompt.trim()) {
      setError("Please upload an image and enter a prompt.");
      return;
    }
    setLoading(true);
    setError(null);
    setResultUrl(null);
    try {
      const url = await imageToVideo(prompt.trim(), preview, {
        duration,
        resolution,
      });
      setResultUrl(url);

      // Save to history
      try {
        const thumbnail = await createThumbnail(preview, 150);
        addToHistory({
          type: "video",
          prompt: prompt.trim(),
          inputImage: thumbnail,
          resultUrl: url,
          metadata: {
            duration,
            resolution,
          },
        });
      } catch (historyErr) {
        console.error("Failed to save to history:", historyErr);
        // Don't fail the whole operation if history save fails
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [preview, prompt, duration, resolution]);

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

      <div className="form">
        <label className="block">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
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
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>

        <label className="block">
          <span>Resolution (lower = cheaper)</span>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as "360p" | "480p" | "720p")}
          >
            <option value="360p">360p (640x360) - Lowest cost</option>
            <option value="480p">480p (854x480) - Recommended</option>
            <option value="720p">720p (1280x720) - Higher cost</option>
          </select>
        </label>

        <ImageUpload preview={preview} onFileSelect={onFileSelect} />

        <button type="button" onClick={submit} disabled={loading || !preview || !prompt.trim()}>
          {loading ? "Generating video…" : "Generate video"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
