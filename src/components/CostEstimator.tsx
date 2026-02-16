interface CostEstimatorProps {
  type: "image" | "video";
  // For images
  model?: "grok-imagine-image" | "grok-imagine-image-pro";
  imageCount?: number;
  // For videos
  duration?: number;
  resolution?: "360p" | "480p" | "720p";
}

// Pricing constants (in USD)
const PRICING = {
  image: {
    "grok-imagine-image": 0.02,
    "grok-imagine-image-pro": 0.07,
  },
  video: {
    // Base price per second
    basePerSecond: 0.01,
    // Resolution multipliers
    resolution: {
      "360p": 0.55, // 45% discount
      "480p": 1.0,  // baseline
      "720p": 1.8,  // 80% premium
    },
  },
};

export default function CostEstimator({
  type,
  model = "grok-imagine-image",
  imageCount = 1,
  duration = 3,
  resolution = "480p",
}: CostEstimatorProps) {
  const calculateCost = (): number => {
    if (type === "image") {
      const pricePerImage = PRICING.image[model];
      return pricePerImage * imageCount;
    } else {
      // Video cost calculation
      const basePrice = PRICING.video.basePerSecond * duration;
      const resolutionMultiplier = PRICING.video.resolution[resolution];
      return basePrice * resolutionMultiplier;
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
            <span className="cost-detail">
              {imageCount} image{imageCount > 1 ? "s" : ""} × ${PRICING.image[model].toFixed(2)}
            </span>
            {model === "grok-imagine-image-pro" && (
              <span className="cost-detail-note">Pro model (3.5× standard)</span>
            )}
          </>
        ) : (
          <>
            <span className="cost-detail">
              {duration}s video @ {resolution}
            </span>
            {resolution === "360p" && (
              <span className="cost-detail-note">45% savings vs 480p</span>
            )}
            {resolution === "720p" && (
              <span className="cost-detail-note">80% premium vs 480p</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

