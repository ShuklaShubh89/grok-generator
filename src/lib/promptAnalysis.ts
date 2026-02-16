/**
 * Prompt analysis and risk assessment for moderation prediction.
 * Analyzes user's history to predict likelihood of moderation.
 */

import { getModerationHistory, type ModerationEvent } from "./moderationTracking";
import { checkTextModeration, type TextModerationResult } from "./grokTextModeration";
import { PRICING } from "./pricing";

export interface SimilarPrompt {
  event: ModerationEvent;
  similarity: number;
}

export interface RiskAssessment {
  riskScore: number; // 0-1, higher = more likely to be moderated
  confidence: number; // 0-1, higher = more data to base prediction on
  similarModerated: SimilarPrompt[];
  similarSuccessful: SimilarPrompt[];
  riskyWords: string[];
  suggestions: string[];
  estimatedWaste: number;
  grokAnalysis?: TextModerationResult; // Grok's AI-based analysis
}

/**
 * Calculate similarity between two strings using word overlap
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  let overlap = 0;
  set1.forEach(word => {
    if (set2.has(word)) overlap++;
  });
  
  const union = new Set([...set1, ...set2]).size;
  return overlap / union; // Jaccard similarity
}

/**
 * Find similar prompts in history
 */
function findSimilarPrompts(
  prompt: string,
  type: 'image' | 'video',
  minSimilarity = 0.2
): { moderated: SimilarPrompt[]; successful: SimilarPrompt[] } {
  const history = getModerationHistory();
  const typeHistory = history.filter(e => e.type === type);
  
  const similar: SimilarPrompt[] = [];
  
  typeHistory.forEach(event => {
    const similarity = calculateSimilarity(prompt, event.prompt);
    if (similarity >= minSimilarity) {
      similar.push({ event, similarity });
    }
  });
  
  // Sort by similarity (highest first)
  similar.sort((a, b) => b.similarity - a.similarity);
  
  const moderated = similar.filter(s => s.event.moderated).slice(0, 5);
  const successful = similar.filter(s => !s.event.moderated).slice(0, 5);
  
  return { moderated, successful };
}

/**
 * Extract words that commonly appear in moderated prompts
 */
function findRiskyWords(prompt: string, type: 'image' | 'video'): string[] {
  const history = getModerationHistory();
  const typeHistory = history.filter(e => e.type === type);
  
  const moderatedPrompts = typeHistory.filter(e => e.moderated);
  const successfulPrompts = typeHistory.filter(e => !e.moderated);
  
  if (moderatedPrompts.length === 0) return [];
  
  // Count word frequency in moderated vs successful
  const moderatedWords = new Map<string, number>();
  const successfulWords = new Map<string, number>();
  
  moderatedPrompts.forEach(e => {
    const words = e.prompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    words.forEach(word => {
      moderatedWords.set(word, (moderatedWords.get(word) || 0) + 1);
    });
  });
  
  successfulPrompts.forEach(e => {
    const words = e.prompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    words.forEach(word => {
      successfulWords.set(word, (successfulWords.get(word) || 0) + 1);
    });
  });
  
  // Find words that appear more in moderated than successful
  const riskyWords: Array<{ word: string; risk: number }> = [];
  const promptWords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  promptWords.forEach(word => {
    const moderatedCount = moderatedWords.get(word) || 0;
    const successfulCount = successfulWords.get(word) || 0;
    const totalCount = moderatedCount + successfulCount;
    
    if (totalCount >= 2 && moderatedCount > successfulCount) {
      const risk = moderatedCount / totalCount;
      if (risk > 0.6) { // Word appears in 60%+ of moderated prompts
        riskyWords.push({ word, risk });
      }
    }
  });
  
  riskyWords.sort((a, b) => b.risk - a.risk);
  return riskyWords.slice(0, 5).map(w => w.word);
}

/**
 * Generate suggestions to reduce moderation risk
 */
function generateSuggestions(
  riskyWords: string[],
  similarSuccessful: SimilarPrompt[]
): string[] {
  const suggestions: string[] = [];
  
  if (riskyWords.length > 0) {
    suggestions.push(`Consider removing or replacing: ${riskyWords.join(', ')}`);
  }
  
  if (similarSuccessful.length > 0) {
    const bestMatch = similarSuccessful[0];
    suggestions.push(`Try phrasing similar to: "${bestMatch.event.prompt}"`);
  }
  
  suggestions.push('Use more generic, descriptive terms');
  suggestions.push('Avoid specific descriptions of people or sensitive topics');
  
  return suggestions.slice(0, 4);
}

/**
 * Assess risk of moderation for a prompt
 */
export function assessModerationRisk(
  prompt: string,
  type: 'image' | 'video',
  cost: number
): RiskAssessment {
  const { moderated, successful } = findSimilarPrompts(prompt, type);
  const riskyWords = findRiskyWords(prompt, type);

  // Calculate risk score based on similar prompts
  let riskScore = 0;
  let confidence = 0;

  const totalSimilar = moderated.length + successful.length;

  if (totalSimilar > 0) {
    // Weight by similarity
    const moderatedWeight = moderated.reduce((sum, s) => sum + s.similarity, 0);
    const successfulWeight = successful.reduce((sum, s) => sum + s.similarity, 0);
    const totalWeight = moderatedWeight + successfulWeight;

    if (totalWeight > 0) {
      riskScore = moderatedWeight / totalWeight;
      confidence = Math.min(totalSimilar / 10, 1); // Max confidence at 10 similar prompts
    }
  }

  // Boost risk if risky words found
  if (riskyWords.length > 0) {
    riskScore = Math.min(riskScore + (riskyWords.length * 0.1), 1);
    confidence = Math.max(confidence, 0.5);
  }

  const suggestions = generateSuggestions(riskyWords, successful);

  // Estimated waste includes both generation cost AND moderation fee ($0.05)
  // if content gets moderated
  const estimatedWaste = riskScore * (cost + PRICING.moderationFee);

  return {
    riskScore,
    confidence,
    similarModerated: moderated,
    similarSuccessful: successful,
    riskyWords,
    suggestions,
    estimatedWaste,
  };
}

/**
 * Assess risk with Grok AI analysis (async version)
 * This combines historical analysis with Grok's AI-based moderation check
 */
export async function assessModerationRiskWithGrok(
  prompt: string,
  type: 'image' | 'video',
  cost: number
): Promise<RiskAssessment> {
  // Get historical analysis first
  const baseAssessment = assessModerationRisk(prompt, type, cost);

  try {
    // Get Grok's AI analysis
    const grokAnalysis = await checkTextModeration(prompt);

    // Combine both analyses
    let combinedRiskScore = baseAssessment.riskScore;
    let combinedConfidence = baseAssessment.confidence;

    if (grokAnalysis.confidence > 0) {
      // Grok says it's unsafe
      if (!grokAnalysis.safe) {
        // Weight Grok's analysis heavily (70%) with historical data (30%)
        combinedRiskScore = (grokAnalysis.confidence * 0.7) + (baseAssessment.riskScore * 0.3);
        combinedConfidence = Math.max(grokAnalysis.confidence, baseAssessment.confidence);
      } else {
        // Grok says it's safe - reduce risk score
        combinedRiskScore = baseAssessment.riskScore * 0.5; // Reduce by 50%
        combinedConfidence = Math.max(grokAnalysis.confidence * 0.8, baseAssessment.confidence);
      }
    }

    // Combine suggestions
    const combinedSuggestions = [
      ...baseAssessment.suggestions,
      ...grokAnalysis.suggestions
    ].slice(0, 5); // Limit to 5 suggestions

    // Combine risky words with Grok's issues
    const combinedRiskyWords = [
      ...baseAssessment.riskyWords,
      ...grokAnalysis.issues.map(issue => issue.toLowerCase())
    ];

    return {
      ...baseAssessment,
      riskScore: combinedRiskScore,
      confidence: combinedConfidence,
      suggestions: combinedSuggestions,
      riskyWords: Array.from(new Set(combinedRiskyWords)), // Remove duplicates
      estimatedWaste: combinedRiskScore * cost,
      grokAnalysis,
    };
  } catch (err) {
    console.error('Failed to get Grok analysis, using historical data only:', err);
    // If Grok fails, return the base assessment
    return baseAssessment;
  }
}

