import { useState, useCallback } from "react";
import { imageEdit } from "../lib/grokApi";
import ImageUpload from "../components/ImageUpload";
import { addToHistory, createThumbnail } from "../lib/history";

export default function ImageToImage() {
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<"grok-imagine-image" | "grok-imagine-image-pro">("grok-imagine-image");
  const [imageCount, setImageCount] = useState(1);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFileSelect = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    setError(null);
    setResultUrls([]);
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
    setResultUrls([]);
    try {
      const urls = await imageEdit(prompt.trim(), preview, { model, count: imageCount });
      setResultUrls(urls);

      // Save to history (save each generated image)
      try {
        const thumbnail = await createThumbnail(preview, 150);
        for (const url of urls) {
          addToHistory({
            type: "image",
            prompt: prompt.trim(),
            inputImage: thumbnail,
            resultUrl: url,
            metadata: {
              model,
              imageCount: urls.length,
            },
          });
        }
      } catch (historyErr) {
        console.error("Failed to save to history:", historyErr);
        // Don't fail the whole operation if history save fails
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [preview, prompt, model, imageCount]);

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

      <div className="form">
        <label className="block">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Change the sky to sunset and add birds"
            rows={3}
          />
        </label>

        <label className="block">
          <span>Model (Pro = higher quality, 3.5x cost)</span>
          <select value={model} onChange={(e) => setModel(e.target.value as typeof model)}>
            <option value="grok-imagine-image">Standard ($0.02/image) - Recommended</option>
            <option value="grok-imagine-image-pro">Pro ($0.07/image) - Premium quality</option>
          </select>
        </label>

        <label className="block">
          <span>Number of images to generate</span>
          <select value={imageCount} onChange={(e) => setImageCount(Number(e.target.value))}>
            <option value={1}>1 image</option>
            <option value={2}>2 images</option>
            <option value={3}>3 images</option>
            <option value={4}>4 images</option>
          </select>
        </label>

        <ImageUpload preview={preview} onFileSelect={onFileSelect} />

        <button type="button" onClick={submit} disabled={loading || !preview || !prompt.trim()}>
          {loading ? "Generating…" : `Generate ${imageCount} image${imageCount > 1 ? "s" : ""}`}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
