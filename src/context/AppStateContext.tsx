import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { imageEdit, imageToVideo, videoEdit, videoExtend, getLastXaiApiErrorTrace } from "../lib/grokApi";
import { addToHistory, createThumbnail, createVideoThumbnail } from "../lib/history";
import { autoSaveFile, generateAutoSaveFilename, isAutoSaveEnabled } from "../lib/autoSave";
import { assessModerationRiskWithGrok, type RiskAssessment } from "../lib/promptAnalysis";
import { buildVideoSourceProxyUrl } from "../lib/videoSourceProxy";
import { rewritePromptWithGrok, type PromptRewriteResult } from "../lib/grokPromptRewrite";


// State for Image-to-Image page
interface ImageToImageState {
  preview: string | null;
  prompt: string;
  model: "grok-imagine-image" | "grok-imagine-image-pro";
  imageCount: number;
  resultUrls: string[];
  sourceUrls: string[];
  loading: boolean;
  error: string | null;
}

// State for Image-to-Video page
interface ImageToVideoState {
  mode: "generate" | "edit" | "extend";
  preview: string | null;
  sourceVideoUrl: string;
  sourceVideoName: string | null;
  sourceVideoKey: string | null;
  prompt: string;
  duration: number;
  resolution: "480p" | "720p";
  resultUrl: string | null;
  sourceUrl: string | null;
  loading: boolean;
  error: string | null;
  diagnostics: string | null;
}

interface AppState {
  imageToImage: ImageToImageState;
  imageToVideo: ImageToVideoState;
}

interface AppStateContextType {
  state: AppState;
  updateImageToImageState: (updates: Partial<ImageToImageState>) => void;
  updateImageToVideoState: (updates: Partial<ImageToVideoState>) => void;
  generateImages: (onWarning?: (assessment: RiskAssessment) => Promise<boolean>) => Promise<void>;
  generateVideo: (onWarning?: (assessment: RiskAssessment) => Promise<boolean>) => Promise<void>;
  analyzePrompt: (prompt: string, type: 'image' | 'video', cost: number) => Promise<RiskAssessment>;
  rewritePrompt: (prompt: string, type: 'image' | 'video') => Promise<PromptRewriteResult>;
}

const defaultImageToImageState: ImageToImageState = {
  preview: null,
  prompt: "",
  model: "grok-imagine-image",
  imageCount: 1,
  resultUrls: [],
  sourceUrls: [],
  loading: false,
  error: null,
};

const defaultImageToVideoState: ImageToVideoState = {
  mode: "generate",
  preview: null,
  sourceVideoUrl: "",
  sourceVideoName: null,
  sourceVideoKey: null,
  prompt: "",
  duration: 3,
  resolution: "480p",
  resultUrl: null,
  sourceUrl: null,
  loading: false,
  error: null,
  diagnostics: null,
};

const defaultState: AppState = {
  imageToImage: defaultImageToImageState,
  imageToVideo: defaultImageToVideoState,
};

const AppStateContext = createContext<AppStateContextType | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState);

  const updateImageToImageState = (updates: Partial<ImageToImageState>) => {
    setState((prev) => ({
      ...prev,
      imageToImage: { ...prev.imageToImage, ...updates },
    }));
  };

  const updateImageToVideoState = (updates: Partial<ImageToVideoState>) => {
    setState((prev) => ({
      ...prev,
      imageToVideo: { ...prev.imageToVideo, ...updates },
    }));
  };

  const generateImages = async () => {
    const { preview, prompt, model, imageCount } = state.imageToImage;

    if (!preview || !prompt.trim()) {
      updateImageToImageState({ error: "Please upload an image and enter a prompt." });
      return;
    }

    updateImageToImageState({ loading: true, error: null, resultUrls: [], sourceUrls: [] });

    try {
      const result = await imageEdit(prompt.trim(), preview, { model, count: imageCount });
      updateImageToImageState({ resultUrls: result.dataUrls, sourceUrls: result.sourceUrls, loading: false });

      // Auto-save images if enabled
      if (isAutoSaveEnabled()) {
        for (let i = 0; i < result.dataUrls.length; i++) {
          const filename = generateAutoSaveFilename('image', result.dataUrls.length > 1 ? i : undefined);
          await autoSaveFile(result.dataUrls[i], filename, 'image');
        }
      }

      // Save to history - this continues even if user navigates away
      try {
        const thumbnail = await createThumbnail(preview, 150);
        for (const url of result.dataUrls) {
          addToHistory({
            type: "image",
            prompt: prompt.trim(),
            inputImage: thumbnail,
            resultUrl: url,
            metadata: {
              model,
              imageCount: result.dataUrls.length,
            },
          });
        }
      } catch (historyErr) {
        console.error("Failed to save to history:", historyErr);
        // Don't fail the whole operation if history save fails
      }
    } catch (err) {
      updateImageToImageState({
        error: err instanceof Error ? err.message : "Request failed",
        loading: false
      });
    }
  };

  const generateVideo = async () => {
    const { mode, preview, sourceVideoUrl, sourceVideoName, sourceVideoKey, prompt, duration, resolution } = state.imageToVideo;

    if (!prompt.trim()) {
      updateImageToVideoState({ error: "Please enter a prompt." });
      return;
    }

    if (mode === "generate" && !preview) {
      updateImageToVideoState({ error: "Please upload an image and enter a prompt." });
      return;
    }

    if ((mode === "edit" || mode === "extend") && !sourceVideoUrl.trim()) {
      updateImageToVideoState({ error: "Please provide a source video URL and enter a prompt." });
      return;
    }

    let extensionSourceUrl = sourceVideoUrl.trim();
    if ((mode === "edit" || mode === "extend") && sourceVideoKey) {
      try {
        extensionSourceUrl = buildVideoSourceProxyUrl(sourceVideoKey);
      } catch (err) {
        updateImageToVideoState({
          loading: false,
          error: err instanceof Error ? err.message : "Private video upload proxy is not available.",
        });
        return;
      }
    }

    updateImageToVideoState({ loading: true, error: null, diagnostics: null, resultUrl: null, sourceUrl: null });

    try {
      const result =
        mode === "generate"
          ? await imageToVideo(prompt.trim(), preview!, { duration, resolution })
          : mode === "edit"
            ? await videoEdit(prompt.trim(), extensionSourceUrl, sourceVideoName, {
                pollTimeoutMs: 900_000,
              })
            : await videoExtend(prompt.trim(), extensionSourceUrl, sourceVideoName, {
              duration: Math.min(10, Math.max(2, duration)),
              pollTimeoutMs: 900_000, // 15 min for video extension jobs
            });
      updateImageToVideoState({ resultUrl: result.dataUrl, sourceUrl: result.sourceUrl, loading: false });

      // Auto-save video if enabled
      if (isAutoSaveEnabled()) {
        const filename = generateAutoSaveFilename('video');
        await autoSaveFile(result.dataUrl, filename, 'video');
      }

      // Save to history - this continues even if user navigates away
      try {
        const inputThumbnail =
          mode === "generate"
            ? await createThumbnail(preview!, 150)
            : sourceVideoUrl.trim().startsWith("data:")
              ? await createVideoThumbnail(sourceVideoUrl.trim(), 150)
              : sourceVideoUrl.trim();
        const videoThumbnail = await createVideoThumbnail(result.dataUrl, 200);
        addToHistory({
          type: "video",
          prompt: prompt.trim(),
          inputImage: inputThumbnail,
          resultUrl: videoThumbnail,
            metadata: {
              duration,
              resolution,
              mode,
              sourceVideoName: sourceVideoName ?? undefined,
              sourceVideoKey: sourceVideoKey ?? undefined,
              ...(mode === "extend" ? { sourceVideoUrl: sourceVideoUrl.trim() } : {}),
            },
          });
      } catch (historyErr) {
        console.error("Failed to save to history:", historyErr);
        // Don't fail the whole operation if history save fails
      }
    } catch (err) {
      updateImageToVideoState({
        error: err instanceof Error ? err.message : "Request failed",
        diagnostics: getLastXaiApiErrorTrace()
          ? JSON.stringify(getLastXaiApiErrorTrace(), null, 2)
          : null,
        loading: false
      });
    }
  };

  const analyzePrompt = async (prompt: string, type: 'image' | 'video', cost: number): Promise<RiskAssessment> => {
    return await assessModerationRiskWithGrok(prompt, type, cost);
  };

  const rewritePrompt = async (prompt: string, type: 'image' | 'video'): Promise<PromptRewriteResult> => {
    return await rewritePromptWithGrok(prompt, type);
  };

  return (
    <AppStateContext.Provider
      value={{
        state,
        updateImageToImageState,
        updateImageToVideoState,
        generateImages,
        generateVideo,
        analyzePrompt,
        rewritePrompt,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return context;
}
