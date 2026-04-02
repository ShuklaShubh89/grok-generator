import { generateText } from "ai";
import { createXai } from "@ai-sdk/xai";

let userApiKey: string | null = null;

export interface PromptRewriteResult {
  rewrittenPrompt: string;
  rationale: string;
  changes: string[];
}

export function syncPromptRewriteApiKey(key: string | null): void {
  userApiKey = key?.trim() || null;
}

function getApiKey(): string {
  if (!userApiKey) throw new Error("Grok API key is not set. Please log in.");
  return userApiKey;
}

function getBaseUrl() {
  return import.meta.env.VITE_GROK_API_URL ?? "/v1";
}

function getXai() {
  return createXai({
    apiKey: getApiKey(),
    baseURL: getBaseUrl(),
  });
}

export async function rewritePromptWithGrok(
  prompt: string,
  type: "image" | "video"
): Promise<PromptRewriteResult> {
  const systemPrompt = `You rewrite prompts for xAI ${type} generation.

Your job:
- Keep the user's core creative intent.
- Tone down loaded, explicit, or overly specific wording into neutral visual language.
- Prefer wording about composition, lighting, motion, mood, styling, environment, and camera behavior.
- Do not add new subject matter.
- Do not explain policy or refuse. This is an advisory rewrite helper only.
- Keep the rewrite concise and ready to paste into an image/video prompt field.

Return ONLY valid JSON:
{
  "rewrittenPrompt": "string",
  "rationale": "short string",
  "changes": ["short change 1", "short change 2"]
}`;

  const { text } = await generateText({
    model: getXai()("grok-4-1-fast-reasoning"),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
  });

  const parsed = JSON.parse(text.trim()) as Partial<PromptRewriteResult>;
  if (
    typeof parsed.rewrittenPrompt !== "string" ||
    !parsed.rewrittenPrompt.trim() ||
    typeof parsed.rationale !== "string" ||
    !Array.isArray(parsed.changes)
  ) {
    throw new Error("Invalid rewrite response from Grok");
  }

  return {
    rewrittenPrompt: parsed.rewrittenPrompt.trim(),
    rationale: parsed.rationale.trim(),
    changes: parsed.changes.filter((change): change is string => typeof change === "string").slice(0, 4),
  };
}
