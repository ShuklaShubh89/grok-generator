import { useState, useCallback } from "react";
import ImageUpload from "../components/ImageUpload";
import CostEstimator from "../components/CostEstimator";
import AutoSaveSettings from "../components/AutoSaveSettings";
import { useAppState } from "../context/AppStateContext";

export default function ImageToImage() {
  const { state, updateImageToImageState, generateImages } = useAppState();
  const { preview, prompt, model, imageCount, resultUrls, loading, error } = state.imageToImage;

  const [localError, setLocalError] = useState<string | null>(null);

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
    await generateImages();
  }, [generateImages]);

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

        <button type="button" onClick={submit} disabled={loading || !preview || !prompt.trim()}>
          {loading ? "Generating…" : `Generate ${imageCount} image${imageCount > 1 ? "s" : ""}`}
        </button>
      </div>

      {displayError && <p className="error">{displayError}</p>}
    </div>
  );
}
