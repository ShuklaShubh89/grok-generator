import { generateText } from 'ai';
import { createXai } from '@ai-sdk/xai';

let userApiKey: string | null = null;

/** Set the API key (should match the one used in grokApi.ts) */
export function setGrokTextModerationApiKey(key: string | null): void {
  userApiKey = key?.trim() || null;
}

function getApiKey(): string {
  if (!userApiKey) throw new Error("Grok API key is not set. Please log in.");
  return userApiKey;
}

const getBaseUrl = () =>
  import.meta.env.VITE_GROK_API_URL ?? "https://api.x.ai/v1";

function getXai() {
  return createXai({
    apiKey: getApiKey(),
    baseURL: getBaseUrl(),
  });
}

export interface TextModerationResult {
  safe: boolean;
  confidence: number; // 0-1
  issues: string[];
  suggestions: string[];
  reasoning: string;
}

/**
 * Use Grok to analyze a text prompt for potential moderation issues
 * before sending it to image/video generation APIs.
 */
export async function checkTextModeration(prompt: string): Promise<TextModerationResult> {
  try {
    const systemPrompt = `You are a content moderation assistant for xAI's image and video generation APIs. Analyze the following prompt for potential policy violations.

Common issues that trigger moderation:
- Specific descriptions of real people (names, identifiable features)
- Explicit or sexual content
- Violence, gore, or harm
- Hate speech or discrimination
- Illegal activities
- Privacy violations
- Copyrighted characters or brands
- Political figures or celebrities

Respond ONLY with valid JSON in this exact format:
{
  "safe": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1", "suggestion2"],
  "reasoning": "brief explanation"
}

Be conservative - if unsure, mark as potentially unsafe.`;

    const { text } = await generateText({
      model: getXai()('grok-4-1-fast-reasoning'),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this prompt: "${prompt}"` }
      ],
      temperature: 0.3, // Lower temperature for more consistent analysis
    });

    // Parse the JSON response
    const result = JSON.parse(text.trim());

    // Validate the response structure
    if (typeof result.safe !== 'boolean' || 
        typeof result.confidence !== 'number' ||
        !Array.isArray(result.issues) ||
        !Array.isArray(result.suggestions)) {
      throw new Error('Invalid response format from Grok');
    }

    return result as TextModerationResult;
  } catch (err) {
    console.error('Grok text moderation error:', err);
    
    // Fallback: if Grok fails, return a safe result to not block generation
    // The existing similarity-based system will still catch issues
    return {
      safe: true,
      confidence: 0,
      issues: [],
      suggestions: [],
      reasoning: `Error analyzing prompt: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * Sync the API key with the main grokApi module
 */
export function syncApiKey(key: string | null): void {
  setGrokTextModerationApiKey(key);
}

