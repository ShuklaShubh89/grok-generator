/**
 * Preflight check system - test prompts with cheap 1s 480p video before expensive generation
 */

import { imageToVideo } from "./grokApi";
import { calculateVideoCost, calculatePreflightCost } from "./pricing";

export interface PreflightResult {
  success: boolean;
  passed: boolean; // true if not moderated
  error?: string;
  testVideoUrl?: string;
  cost: number;
}

/**
 * Run a preflight check: generate a 1-second 480p video to test for moderation
 * This costs ~$0.052 (image input + 1s @ 480p) but can save you from wasting money on a full video that gets moderated
 */
export async function runPreflightCheck(
  prompt: string,
  imageDataUri: string
): Promise<PreflightResult> {
  const preflightCost = calculatePreflightCost();

  try {
    // Generate minimal video: 1 second, 480p (lowest supported resolution)
    const testVideoUrl = await imageToVideo(prompt, imageDataUri, {
      duration: 1,
      resolution: "480p",
    });

    // If we got here, moderation passed!
    return {
      success: true,
      passed: true,
      testVideoUrl,
      cost: preflightCost,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check if error is moderation-related
    const moderationKeywords = [
      "moderation",
      "content policy",
      "policy violation",
      "inappropriate",
      "violates",
      "rejected",
      "flagged",
      "unsafe content",
    ];

    const isModeration = moderationKeywords.some((keyword) =>
      errorMessage.toLowerCase().includes(keyword)
    );

    if (isModeration) {
      // Moderation failed - this is actually a "successful" preflight (caught the issue!)
      return {
        success: true,
        passed: false,
        error: errorMessage,
        cost: preflightCost,
      };
    }

    // Some other error (network, API, etc.)
    return {
      success: false,
      passed: false,
      error: errorMessage,
      cost: 0, // May not have been charged if request failed early
    };
  }
}

/**
 * Calculate potential savings from preflight check
 */
export function calculatePreflightSavings(
  fullVideoDuration: number,
  fullVideoResolution: "480p" | "720p"
): { preflightCost: number; fullCost: number; potentialSavings: number } {
  const preflightCost = calculatePreflightCost();
  const fullCost = calculateVideoCost(fullVideoDuration, fullVideoResolution);

  // If preflight catches moderation, you save the full cost minus preflight cost
  const potentialSavings = fullCost - preflightCost;

  return {
    preflightCost,
    fullCost,
    potentialSavings,
  };
}

/**
 * Determine if preflight check is recommended based on risk assessment
 */
export function shouldRecommendPreflight(
  riskScore: number,
  confidence: number,
  videoDuration: number,
  videoResolution: string
): boolean {
  // Recommend preflight if:
  // 1. Risk is medium-high (>30%) with decent confidence (>20%)
  // 2. OR generating expensive video (long duration or high resolution)

  const isRisky = riskScore > 0.3 && confidence > 0.2;
  const isExpensive = videoDuration > 5 || videoResolution === "720p";

  return isRisky || isExpensive;
}

