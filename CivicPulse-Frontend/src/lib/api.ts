import type {
  AdminSettings,
  AiChatResponse,
  AuthSession,
  CreatePostRequest,
  CurrentUser,
  GeocodeSuggestion,
  HealthResponse,
  IntegrityVerifyResponse,
  ListPostsQuery,
  PagedPostsResponse,
  Post,
  ReverseGeocodeResponse,
} from '../types/civicpulse';

const AUTH_STORAGE_KEY = 'civicpulse_auth_session_v1';
const CLIENT_ID_KEY = 'civicpulse_client_id_v1';

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
).replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly isNetworkError: boolean;

  constructor(message: string, status = 0, code = 'API_ERROR', isNetworkError = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.isNetworkError = isNetworkError;
  }
}

export function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing && existing.length > 4) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `cp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return 'cp-browser-client';
  }
}

export function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: AuthSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota errors in private mode
  }
}

export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith('data:') || mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
    return mediaUrl;
  }
  const normalized = mediaUrl.startsWith('/') ? mediaUrl : `/${mediaUrl}`;
  return `${API_BASE_URL}${normalized}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

async function requestJson<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; headers: Headers }> {
  const method = opts.method ?? 'GET';
  const retries = opts.retries ?? (method === 'GET' ? 2 : 0);
  const timeoutMs = opts.timeoutMs ?? 22_000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const controller = new AbortController();
    let callerAborted = false;
    const onExternalAbort = () => {
      callerAborted = true;
      controller.abort();
    };
    opts.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = new Headers();
      headers.set('Accept', 'application/json');
      headers.set('X-Client-Id', getOrCreateClientId());
      if (opts.body !== undefined) {
        headers.set('Content-Type', 'application/json');
      }
      if (opts.token) {
        headers.set('Authorization', `Bearer ${opts.token}`);
      }

      const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `Request failed with HTTP ${response.status}`;
        let code = `HTTP_${response.status}`;
        try {
          const errPayload = (await response.json()) as { error?: string; code?: string };
          if (errPayload?.error) message = errPayload.error;
          if (errPayload?.code) code = errPayload.code;
        } catch {
          // Non-JSON error body
        }
        throw new ApiError(message, response.status, code, false);
      }

      const data = (await response.json()) as T;
      return { data, headers: response.headers };
    } catch (err) {
      if (callerAborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      if (err instanceof ApiError) {
        throw err;
      }
      lastError = err;
      const isLast = attempt >= retries;
      if (!isLast) {
        await new Promise((r) => window.setTimeout(r, 250 * (attempt + 1)));
      }
    } finally {
      window.clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  const msg =
    lastError instanceof DOMException && lastError.name === 'AbortError'
      ? 'Request timed out contacting CivicPulse backend'
      : 'Unable to reach CivicPulse backend (offline or unreachable)';
  throw new ApiError(msg, 0, 'NETWORK_UNREACHABLE', true);
}

export const apiClient = {
  async getHealth(): Promise<HealthResponse> {
    const { data } = await requestJson<HealthResponse>('/health', { retries: 1, timeoutMs: 8_000 });
    return data;
  },

  async listPosts(query: ListPostsQuery = {}, token?: string | null): Promise<PagedPostsResponse> {
    const params = new URLSearchParams();
    if (query.category && query.category !== 'All') params.set('category', query.category);
    if (query.verified_only !== undefined) params.set('verified_only', String(query.verified_only));
    if (query.search?.trim()) params.set('search', query.search.trim());
    if (query.exclude_quarantined !== undefined) {
      params.set('exclude_quarantined', String(query.exclude_quarantined));
    }
    if (query.lat !== undefined && query.lng !== undefined) {
      params.set('lat', String(query.lat));
      params.set('lng', String(query.lng));
    }
    if (query.radius_km !== undefined) params.set('radius_km', String(query.radius_km));
    if (query.sort) params.set('sort', query.sort);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));

    const qs = params.toString();
    const { data, headers } = await requestJson<Post[]>(`/api/posts${qs ? `?${qs}` : ''}`, {
      token,
    });
    return {
      posts: data,
      totalCount: Number(headers.get('x-total-count') ?? data.length),
      limit: Number(headers.get('x-limit') ?? 100),
      offset: Number(headers.get('x-offset') ?? 0),
    };
  },

  async createPost(payload: CreatePostRequest, token?: string | null): Promise<Post> {
    const { data } = await requestJson<Post>('/api/posts', {
      method: 'POST',
      body: payload,
      token,
      timeoutMs: 30_000,
    });
    return data;
  },

  async verifyPost(id: string, token?: string | null): Promise<Post> {
    const { data } = await requestJson<Post>(`/api/posts/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      token,
    });
    return data;
  },

  async flagPost(id: string, token?: string | null): Promise<Post> {
    const { data } = await requestJson<Post>(`/api/posts/${encodeURIComponent(id)}/flag`, {
      method: 'POST',
      token,
    });
    return data;
  },

  async toggleResolve(id: string, token?: string | null): Promise<Post> {
    const { data } = await requestJson<Post>(`/api/posts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      token,
    });
    return data;
  },

  async addComment(id: string, author: string | undefined, text: string, token?: string | null): Promise<Post> {
    const { data } = await requestJson<Post>(`/api/posts/${encodeURIComponent(id)}/comment`, {
      method: 'POST',
      body: { author: author?.trim() || undefined, text },
      token,
    });
    return data;
  },

  async verifyIntegrity(id: string): Promise<IntegrityVerifyResponse> {
    const { data } = await requestJson<IntegrityVerifyResponse>(
      `/api/posts/${encodeURIComponent(id)}/verify-integrity`,
    );
    return data;
  },

  async aiChat(message: string, userLat?: number, userLng?: number): Promise<AiChatResponse> {
    const { data } = await requestJson<AiChatResponse>('/api/ai/chat', {
      method: 'POST',
      body: {
        message,
        user_lat: userLat,
        user_lng: userLng,
      },
      timeoutMs: 30_000,
    });
    return data;
  },

  async login(email: string, password: string): Promise<AuthSession> {
    const { data } = await requestJson<AuthSession>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    return data;
  },

  async register(name: string, email: string, password: string): Promise<AuthSession> {
    const { data } = await requestJson<AuthSession>('/api/auth/register', {
      method: 'POST',
      body: { name, email, password },
    });
    return data;
  },

  async logout(token: string): Promise<void> {
    await requestJson<{ logged_out: boolean }>('/api/auth/logout', {
      method: 'POST',
      token,
    });
  },

  async me(token: string): Promise<CurrentUser> {
    const { data } = await requestJson<CurrentUser>('/api/auth/me', {
      token,
      retries: 0,
    });
    return data;
  },

  async getAdminSettings(token: string): Promise<AdminSettings> {
    const { data } = await requestJson<AdminSettings>('/api/admin/settings', {
      token,
    });
    return data;
  },

  /**
   * Fetch live guest-upload policy cleanly for any role:
   * Admins query `/api/admin/settings`; Guests/Users query `/health` (same backend setting) to avoid 401/403.
   */
  async fetchGuestUploadPolicy(session: AuthSession | null): Promise<boolean> {
    if (session?.role === 'admin') {
      const settings = await this.getAdminSettings(session.token);
      return settings.allow_guest_uploads;
    }
    const health = await this.getHealth();
    return health.allow_guest_uploads;
  },

  async updateAdminSettings(token: string, allowGuestUploads: boolean): Promise<AdminSettings> {
    const { data } = await requestJson<AdminSettings>('/api/admin/settings', {
      method: 'POST',
      body: { allow_guest_uploads: allowGuestUploads },
      token,
    });
    return data;
  },

  async listAdminPending(token: string): Promise<Post[]> {
    const { data } = await requestJson<Post[]>('/api/admin/pending', {
      token,
    });
    return data;
  },

  async approvePost(token: string, id: string): Promise<Post> {
    const { data } = await requestJson<Post>(`/api/admin/posts/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      token,
    });
    return data;
  },

  async rejectPost(token: string, id: string): Promise<Post> {
    const { data } = await requestJson<Post>(`/api/admin/posts/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      token,
    });
    return data;
  },

  async geocodeSearch(
    query: string,
    limit = 5,
    signal?: AbortSignal,
  ): Promise<GeocodeSuggestion[]> {
    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(limit),
    });
    const { data } = await requestJson<GeocodeSuggestion[]>(`/api/geocode/search?${params.toString()}`, {
      retries: 0,
      timeoutMs: 8_000,
      signal,
    });
    return data;
  },

  async geocodeReverse(
    lat: number,
    lng: number,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodeResponse> {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });
    const { data } = await requestJson<ReverseGeocodeResponse>(`/api/geocode/reverse?${params.toString()}`, {
      retries: 0,
      timeoutMs: 8_000,
      signal,
    });
    return data;
  },
};
