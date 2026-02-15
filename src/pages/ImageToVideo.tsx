import { useState, useCallback } from "react";
import { imageToVideo } from "../lib/grokApi";

export default function ImageToVideo() {
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
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
        duration: 5,
        aspectRatio: "16:9",
        resolution: "480p",
      });
      setResultUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [preview, prompt]);

  return (
    <div className="page">
      <h1>Image to Video</h1>
      <p className="subtitle">Upload an image and describe the motion. The model returns a short video.</p>

      <div className="form">
        <label className="block">
          <span>Image</span>
          <input type="file" accept="image/*" onChange={onFileChange} />
        </label>
        {preview && (
          <div className="preview-wrap">
            <img src={preview} alt="Upload preview" className="preview-img" />
          </div>
        )}

        <label className="block">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Animate the clouds drifting and trees swaying gently"
            rows={3}
          />
        </label>

        <button type="button" onClick={submit} disabled={loading || !preview || !prompt.trim()}>
          {loading ? "Generating video…" : "Generate video"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !resultUrl && (
        <p className="status">Video is being generated. This may take a few minutes.</p>
      )}
      {resultUrl && (
        <div className="result">
          <h2>Result</h2>
          <video src={resultUrl} controls className="result-video" />
        </div>
      )}
    </div>
  );
}
