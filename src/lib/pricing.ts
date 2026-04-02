/**
 * Pricing utilities for xAI API
 * Source: https://x.ai/api/pricing
 */

// Pricing constants (in USD)
export const PRICING = {
  image: {
    // xAI image generation is billed as a flat per-image fee.
    "grok-imagine-image": {
      perImage: 0.07,
    },
    // Keep the Pro variant aligned with the current flat pricing model.
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
 * xAI currently bills image generation as a flat per-image fee.
 */
export function calculateImageCost(
  model: "grok-imagine-image" | "grok-imagine-image-pro",
  count: number
): number {
  const perImage =
    model === "grok-imagine-image" ? PRICING.image[model].perImage : PRICING.image[model];
  return perImage * count;
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
export function calculateModerationFee(_type: 'image' | 'video', count: number = 1): number {
  return PRICING.moderationFee * count;
}
