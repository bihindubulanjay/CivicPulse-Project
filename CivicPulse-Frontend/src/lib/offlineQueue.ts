import type { CreatePostRequest, OfflineQueuedReport } from '../types/civicpulse';
import { ApiError, apiClient } from './api';

const OFFLINE_QUEUE_KEY = 'civicpulse_offline_queue_v1';

export function loadOfflineQueue(): OfflineQueuedReport[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineQueuedReport[]) : [];
  } catch {
    return [];
  }
}

function saveOfflineQueue(items: OfflineQueuedReport[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Handle storage full gracefully
  }
}

export function enqueueOfflineReport(payload: CreatePostRequest): OfflineQueuedReport[] {
  const queue = loadOfflineQueue();
  const entry: OfflineQueuedReport = {
    localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    payload,
  };
  const next = [...queue, entry];
  saveOfflineQueue(next);
  return next;
}

export function clearOfflineReport(localId: string): OfflineQueuedReport[] {
  const next = loadOfflineQueue().filter((item) => item.localId !== localId);
  saveOfflineQueue(next);
  return next;
}

/**
 * Compress an uploaded File into a compact JPEG data URI (`quality = 0.7`, max width `960px`)
 * suitable both for rapid Gemini Vision inspection and resilient `localStorage` offline queueing.
 */
export async function compressFileToJpegDataUrl(file: File, maxWidth = 960, quality = 0.7): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read image file'));
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Unsupported or corrupted image file'));
    el.src = dataUrl;
  });

  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export interface SyncQueueOutcome {
  syncedCount: number;
  remaining: OfflineQueuedReport[];
  blockedByAuth: boolean;
  lastError: string | null;
}

export async function syncOfflineQueue(token?: string | null): Promise<SyncQueueOutcome> {
  const queue = loadOfflineQueue();
  if (queue.length === 0) {
    return { syncedCount: 0, remaining: [], blockedByAuth: false, lastError: null };
  }

  let syncedCount = 0;
  const remaining: OfflineQueuedReport[] = [];
  let blockedByAuth = false;
  let lastError: string | null = null;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      await apiClient.createPost(item.payload, token);
      syncedCount += 1;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        blockedByAuth = true;
        lastError = err.message;
        remaining.push(...queue.slice(i));
        break;
      }
      if (err instanceof ApiError && err.isNetworkError) {
        lastError = err.message;
        remaining.push(...queue.slice(i));
        break;
      }
      // Permanent validation error (400): drop corrupted item so it does not jam queue, report error
      lastError = err instanceof Error ? err.message : 'Dropped invalid queued report';
    }
  }

  saveOfflineQueue(remaining);
  return { syncedCount, remaining, blockedByAuth, lastError };
}
