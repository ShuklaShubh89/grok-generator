import { PRICING, calculateImageCost, calculateVideoCost } from "../lib/pricing";

interface CostEstimatorProps {
  type: "image" | "video";
  // For images
  model?: "grok-imagine-image" | "grok-imagine-image-pro";
  imageCount?: number;
  // For videos
  duration?: number;
  resolution?: "480p" | "720p";
}

export default function CostEstimator({
  type,
  model = "grok-imagine-image",
  imageCount = 1,
  duration = 3,
  resolution = "480p",
}: CostEstimatorProps) {
  const calculateCost = (): number => {
    if (type === "image") {
      return calculateImageCost(model, imageCount);
    } else {
      return calculateVideoCost(duration, resolution);
    }
  };

  const cost = calculateCost();

  return (
    <div className="cost-estimator">
      <div className="cost-estimator-header">
        <span className="cost-estimator-label">Estimated Cost:</span>
        <span className="cost-estimator-value">${cost.toFixed(3)} USD</span>
      </div>
      <div className="cost-estimator-details">
        {type === "image" ? (
          <>
            {model === "grok-imagine-image" ? (
              <span className="cost-detail">
                {imageCount} image{imageCount > 1 ? "s" : ""} × ($0.002 input + $0.02 output) = ${(PRICING.image[model].total * imageCount).toFixed(3)}
              </span>
            ) : (
              <>
                <span className="cost-detail">
                  {imageCount} image{imageCount > 1 ? "s" : ""} × ${PRICING.image[model].toFixed(2)}
                </span>
                <span className="cost-detail-note">Pro model (3.2× standard)</span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="cost-detail">
              Image input: ${PRICING.video.imageInput.toFixed(3)} + {duration}s @ ${PRICING.video.perSecond[resolution].toFixed(2)}/s ({resolution})
            </span>
            {resolution === "720p" && (
              <span className="cost-detail-note">720p is 40% more expensive than 480p</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

