/**
 * Moderation tracking system to detect, store, and analyze content moderation events.
 * Helps users understand what gets moderated and reduce wasted credits.
 */

import { calculateImageEditCost, calculateVideoCost } from "./pricing";

export interface ModerationEvent {
  id: string;
  timestamp: number;
  type: 'image' | 'video';
  prompt: string;
  inputImageHash: string; // Simple hash of input image for similarity detection
  moderated: boolean;
  cost: number;
  errorMessage?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ModerationStats {
  totalAttempts: number;
  totalModerated: number;
  totalCost: number;
  totalWasted: number;
  moderationRate: number;
  imageAttempts: number;
  imageModerated: number;
  videoAttempts: number;
  videoModerated: number;
  imageModerationRate: number;
  videoModerationRate: number;
}

const STORAGE_KEY = 'grok_moderation_history';
const MAX_EVENTS = 500; // Keep last 500 events

/**
 * Simple hash function for image data URLs to detect similar images
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 1000); i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Detect if an error is due to content moderation
 */
export function isModerationError(errorMessage: string): boolean {
  const moderationKeywords = [
    'moderation',
    'content policy',
    'policy violation',
    'inappropriate',
    'violates',
    'not allowed',
    'rejected',
    'flagged',
    'unsafe content',
  ];
  
  const lowerMessage = errorMessage.toLowerCase();
  return moderationKeywords.some(keyword => lowerMessage.includes(keyword));
}

function getGenerationCost(event: {
  type: 'image' | 'video';
  model?: string;
  metadata?: Record<string, unknown>;
}): number {
  if (event.type === 'image') {
    const count = typeof event.metadata?.count === 'number' ? event.metadata.count : 1;
    return calculateImageEditCost(event.model === 'grok-imagine-image-pro' ? 'grok-imagine-image-pro' : 'grok-imagine-image', count);
  }

  const duration = typeof event.metadata?.duration === 'number' ? event.metadata.duration : 3;
  const resolution = event.metadata?.resolution === '720p' ? '720p' : '480p';
  return calculateVideoCost(duration, resolution);
}

/**
 * Get the total cost when content is moderated (generation + moderation fee)
 */
function getModeratedCost(event: {
  type: 'image' | 'video';
  model?: string;
  metadata?: Record<string, unknown>;
}): number {
  const generationCost = getGenerationCost(event);
  const moderationFee = 0.05;
  const count = event.type === 'image' && typeof event.metadata?.count === 'number' ? event.metadata.count : 1;
  return generationCost + (moderationFee * count);
}

/**
 * Add a moderation event to history
 */
export function trackModerationEvent(event: {
  type: 'image' | 'video';
  prompt: string;
  inputImage: string;
  moderated: boolean;
  errorMessage?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}): void {
  try {
    const events = getModerationHistory();
    const outputCount = typeof event.metadata?.count === 'number' ? event.metadata.count : 1;

    const newEvent: ModerationEvent = {
      id: `mod_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      timestamp: Date.now(),
      type: event.type,
      prompt: event.prompt,
      inputImageHash: hashString(event.inputImage),
      moderated: event.moderated,
      // If moderated, include both generation cost + $0.05 moderation fee
      cost: event.moderated
        ? getModeratedCost({ type: event.type, model: event.model, metadata: event.metadata })
        : getGenerationCost({ type: event.type, model: event.model, metadata: event.metadata }),
      errorMessage: event.errorMessage,
      model: event.model,
      metadata: { ...event.metadata, count: outputCount },
    };
    
    events.unshift(newEvent);
    
    // Keep only last MAX_EVENTS
    if (events.length > MAX_EVENTS) {
      events.splice(MAX_EVENTS);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch (err) {
    console.error('Failed to track moderation event:', err);
  }
}

/**
 * Get all moderation events
 */
export function getModerationHistory(): ModerationEvent[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data) as ModerationEvent[];
  } catch (err) {
    console.error('Failed to load moderation history:', err);
    return [];
  }
}

/**
 * Calculate moderation statistics
 */
export function getModerationStats(): ModerationStats {
  const events = getModerationHistory();
  
  const imageEvents = events.filter(e => e.type === 'image');
  const videoEvents = events.filter(e => e.type === 'video');
  
  const totalModerated = events.filter(e => e.moderated).length;
  const imageModerated = imageEvents.filter(e => e.moderated).length;
  const videoModerated = videoEvents.filter(e => e.moderated).length;
  
  const totalCost = events.reduce((sum, e) => sum + e.cost, 0);
  const totalWasted = events.filter(e => e.moderated).reduce((sum, e) => sum + e.cost, 0);
  
  return {
    totalAttempts: events.length,
    totalModerated,
    totalCost,
    totalWasted,
    moderationRate: events.length > 0 ? totalModerated / events.length : 0,
    imageAttempts: imageEvents.length,
    imageModerated,
    videoAttempts: videoEvents.length,
    videoModerated,
    imageModerationRate: imageEvents.length > 0 ? imageModerated / imageEvents.length : 0,
    videoModerationRate: videoEvents.length > 0 ? videoModerated / videoEvents.length : 0,
  };
}

/**
 * Clear all moderation history
 */
export function clearModerationHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
