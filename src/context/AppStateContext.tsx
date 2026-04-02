import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { imageEdit, imageToVideo } from "../lib/grokApi";
import { addToHistory, createThumbnail, createVideoThumbnail } from "../lib/history";
import { autoSaveFile, generateAutoSaveFilename, isAutoSaveEnabled } from "../lib/autoSave";
import { assessModerationRiskWithGrok, type RiskAssessment } from "../lib/promptAnalysis";


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
  preview: string | null;
  prompt: string;
  duration: number;
  resolution: "480p" | "720p";
  resultUrl: string | null;
  sourceUrl: string | null;
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
  sourceUrls: [],
  loading: false,
  error: null,
};

const defaultImageToVideoState: ImageToVideoState = {
  preview: null,
  prompt: "",
  duration: 3,
  resolution: "480p",
  resultUrl: null,
  sourceUrl: null,
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
    const { preview, prompt, duration, resolution } = state.imageToVideo;

    if (!preview || !prompt.trim()) {
      updateImageToVideoState({ error: "Please upload an image and enter a prompt." });
      return;
    }

    updateImageToVideoState({ loading: true, error: null, resultUrl: null, sourceUrl: null });

    try {
      const result = await imageToVideo(prompt.trim(), preview, { duration, resolution });
      updateImageToVideoState({ resultUrl: result.dataUrl, sourceUrl: result.sourceUrl, loading: false });

      // Auto-save video if enabled
      if (isAutoSaveEnabled()) {
        const filename = generateAutoSaveFilename('video');
        await autoSaveFile(result.dataUrl, filename, 'video');
      }

      // Save to history - this continues even if user navigates away
      try {
        const inputThumbnail = await createThumbnail(preview, 150);
        const videoThumbnail = await createVideoThumbnail(result.dataUrl, 200);
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

