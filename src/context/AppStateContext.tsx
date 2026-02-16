import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { imageEdit, imageToVideo } from "../lib/grokApi";
import { addToHistory, createThumbnail, createVideoThumbnail } from "../lib/history";
import { autoSaveFile, generateAutoSaveFilename, isAutoSaveEnabled } from "../lib/autoSave";
import { assessModerationRiskWithGrok, type RiskAssessment } from "../lib/promptAnalysis";
import { calculateImageCost, calculateVideoCost } from "../lib/pricing";

// State for Image-to-Image page
interface ImageToImageState {
  preview: string | null;
  prompt: string;
  model: "grok-imagine-image" | "grok-imagine-image-pro";
  imageCount: number;
  resultUrls: string[];
  loading: boolean;
  error: string | null;
}

// State for Image-to-Video page
interface ImageToVideoState {
  preview: string | null;
  prompt: string;
  duration: number;
  resolution: "480p" | "720p";
  resultUrl: string | null;
  loading: boolean;
  error: string | null;
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
}

const defaultImageToImageState: ImageToImageState = {
  preview: null,
  prompt: "",
  model: "grok-imagine-image",
  imageCount: 1,
  resultUrls: [],
  loading: false,
  error: null,
};

const defaultImageToVideoState: ImageToVideoState = {
  preview: null,
  prompt: "",
  duration: 3,
  resolution: "480p",
  resultUrl: null,
  loading: false,
  error: null,
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

  const generateImages = async (onWarning?: (assessment: RiskAssessment) => Promise<boolean>) => {
    const { preview, prompt, model, imageCount } = state.imageToImage;

    if (!preview || !prompt.trim()) {
      updateImageToImageState({ error: "Please upload an image and enter a prompt." });
      return;
    }

    // Calculate cost for risk assessment
    const totalCost = calculateImageCost(model, imageCount);

    // Assess moderation risk with Grok AI
    const assessment = await assessModerationRiskWithGrok(prompt.trim(), 'image', totalCost);

    // Show warning if risk is medium or high and callback provided
    // Updated thresholds: Medium >= 25%, High >= 50%
    if (onWarning && assessment.riskScore >= 0.25 && assessment.confidence >= 0.3) {
      const shouldProceed = await onWarning(assessment);
      if (!shouldProceed) {
        return; // User cancelled
      }
    }

    updateImageToImageState({ loading: true, error: null, resultUrls: [] });

    try {
      const urls = await imageEdit(prompt.trim(), preview, { model, count: imageCount });
      updateImageToImageState({ resultUrls: urls, loading: false });

      // Auto-save images if enabled
      if (isAutoSaveEnabled()) {
        for (let i = 0; i < urls.length; i++) {
          const filename = generateAutoSaveFilename('image', urls.length > 1 ? i : undefined);
          await autoSaveFile(urls[i], filename, 'image');
        }
      }

      // Save to history - this continues even if user navigates away
      try {
        const thumbnail = await createThumbnail(preview, 150);
        for (const url of urls) {
          addToHistory({
            type: "image",
            prompt: prompt.trim(),
            inputImage: thumbnail,
            resultUrl: url,
            metadata: {
              model,
              imageCount: urls.length,
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

  const generateVideo = async (onWarning?: (assessment: RiskAssessment) => Promise<boolean>) => {
    const { preview, prompt, duration, resolution } = state.imageToVideo;

    if (!preview || !prompt.trim()) {
      updateImageToVideoState({ error: "Please upload an image and enter a prompt." });
      return;
    }

    // Video generation is expensive - always assess risk with Grok AI
    const videoCost = calculateVideoCost(duration, resolution);
    const assessment = await assessModerationRiskWithGrok(prompt.trim(), 'video', videoCost);

    // Show warning if risk is medium or high and callback provided
    // Updated thresholds: Medium >= 25%, High >= 50%
    if (onWarning && assessment.riskScore >= 0.25 && assessment.confidence >= 0.3) {
      const shouldProceed = await onWarning(assessment);
      if (!shouldProceed) {
        return; // User cancelled
      }
    }

    updateImageToVideoState({ loading: true, error: null, resultUrl: null });

    try {
      const url = await imageToVideo(prompt.trim(), preview, { duration, resolution });
      updateImageToVideoState({ resultUrl: url, loading: false });

      // Auto-save video if enabled
      if (isAutoSaveEnabled()) {
        const filename = generateAutoSaveFilename('video');
        await autoSaveFile(url, filename, 'video');
      }

      // Save to history - this continues even if user navigates away
      try {
        const inputThumbnail = await createThumbnail(preview, 150);
        const videoThumbnail = await createVideoThumbnail(url, 200);
        addToHistory({
          type: "video",
          prompt: prompt.trim(),
          inputImage: inputThumbnail,
          resultUrl: videoThumbnail,
          metadata: {
            duration,
            resolution,
          },
        });
      } catch (historyErr) {
        console.error("Failed to save to history:", historyErr);
        // Don't fail the whole operation if history save fails
      }
    } catch (err) {
      updateImageToVideoState({
        error: err instanceof Error ? err.message : "Request failed",
        loading: false
      });
    }
  };

  const analyzePrompt = async (prompt: string, type: 'image' | 'video', cost: number): Promise<RiskAssessment> => {
    return await assessModerationRiskWithGrok(prompt, type, cost);
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

