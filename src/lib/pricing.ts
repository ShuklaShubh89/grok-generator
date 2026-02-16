/**
 * Pricing utilities for xAI API
 * Source: https://x.ai/api/pricing
 */

// Pricing constants (in USD)
export const PRICING = {
  image: {
    // grok-imagine-image pricing
    "grok-imagine-image": {
      input: 0.002,   // Input image cost
      output: 0.02,   // Output image cost (same for 1K and 2K)
      total: 0.022,   // Total: $0.002 + $0.02
    },
    // grok-imagine-image-pro pricing (keeping old value until we get official pricing)
    "grok-imagine-image-pro": 0.07,
  },
  video: {
    // Input image cost for video generation
    imageInput: 0.002,
    // Price per second based on resolution
    perSecond: {
      "480p": 0.05,  // $0.05 per second at 480p
      "720p": 0.07,  // $0.07 per second at 720p
    },
  },
  // Moderation fee - charged when content is moderated (in addition to generation cost)
  moderationFee: 0.05,
} as const;

/**
 * Calculate the cost of generating images
 * For grok-imagine-image: $0.002 (input) + $0.02 (output) = $0.022 per image
 * For grok-imagine-image-pro: $0.07 per image (legacy pricing)
 */
export function calculateImageCost(
  model: "grok-imagine-image" | "grok-imagine-image-pro",
  count: number
): number {
  if (model === "grok-imagine-image") {
    return PRICING.image[model].total * count;
  }
  return PRICING.image[model] * count;
}

/**
 * Calculate the cost of generating a video
 * Formula: image input cost + (duration × per-second rate based on resolution)
 */
export function calculateVideoCost(
  duration: number,
  resolution: "480p" | "720p"
): number {
  const imageInputCost = PRICING.video.imageInput;
  const videoCost = PRICING.video.perSecond[resolution] * duration;
  return imageInputCost + videoCost;
}

/**
 * Calculate the cost of a preflight check (1 second 480p video)
 */
export function calculatePreflightCost(): number {
  return calculateVideoCost(1, "480p");
}

/**
 * Calculate the total cost when content is moderated
 * Moderated content incurs both the generation cost AND a $0.05 moderation fee
 */
export function calculateModeratedImageCost(
  model: "grok-imagine-image" | "grok-imagine-image-pro",
  count: number
): number {
  const generationCost = calculateImageCost(model, count);
  return generationCost + (PRICING.moderationFee * count);
}

/**
 * Calculate the total cost when a video is moderated
 * Moderated content incurs both the generation cost AND a $0.05 moderation fee
 */
export function calculateModeratedVideoCost(
  duration: number,
  resolution: "480p" | "720p"
): number {
  const generationCost = calculateVideoCost(duration, resolution);
  return generationCost + PRICING.moderationFee;
}

/**
 * Calculate the moderation fee for a given type and count
 */
export function calculateModerationFee(type: 'image' | 'video', count: number = 1): number {
  return PRICING.moderationFee * count;
}

