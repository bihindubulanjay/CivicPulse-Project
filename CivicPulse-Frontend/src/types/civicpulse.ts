export type Category = 'Disaster' | 'Nature' | 'Tourism' | 'Road';

export type TravelAdvisory = 'Safe' | 'Caution' | 'Danger';

export type VerificationStatus =
  | 'Unverified'
  | 'Pending Community Verification'
  | 'Pending Admin Approval'
  | 'AI Verified'
  | 'Community Verified'
  | 'Admin Approved'
  | 'Disputed'
  | 'Quarantined'
  | 'Rejected';

export type UserRole = 'admin' | 'user';

export type SortMode = 'newest' | 'priority' | 'nearest' | 'severity';

export type LayoutMode = 'split' | 'map' | 'feed';

export type MobileTab = 'feed' | 'map' | 'admin';

export interface Comment {
  author: string;
  text: string;
  created_at: string;
}

export interface Post {
  id: string;
  title: string;
  description: string;
  translated_description: string;
  category: Category;
  lat: number;
  lng: number;
  location_name: string;
  media_url: string | null;
  is_live_captured: boolean;
  is_on_site: boolean;
  ai_authenticity_score: number;
  ai_reasoning: string;
  travel_advisory: TravelAdvisory;
  severity: number;
  verification_status: VerificationStatus;
  confirmations: number;
  false_flags: number;
  is_resolved: boolean;
  integrity_hash: string;
  author_id?: string | null;
  viewer_vote?: 'verify' | 'flag' | null;
  comments: Comment[];
  created_at: string;
}

export interface CreatePostRequest {
  user_lat?: number;
  user_lng?: number;
  lat: number;
  lng: number;
  title: string;
  description: string;
  category: Category;
  location_name: string;
  media_base64?: string;
  is_live_captured: boolean;
}

export interface ListPostsQuery {
  category?: string;
  verified_only?: boolean;
  search?: string;
  exclude_quarantined?: boolean;
  lat?: number;
  lng?: number;
  radius_km?: number;
  sort?: SortMode;
  limit?: number;
  offset?: number;
}

export interface PagedPostsResponse {
  posts: Post[];
  totalCount: number;
  limit: number;
  offset: number;
}

export interface AuthSession {
  user_id?: string;
  token: string;
  role: UserRole;
  name: string;
  email: string;
  reputation_score: number;
  expires_at: string;
}

export interface CurrentUser {
  user_id?: string;
  role: UserRole;
  name: string;
  email: string;
  reputation_score: number;
}

export interface AdminSettings {
  allow_guest_uploads: boolean;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  posts_count: number;
  gemini_configured: boolean;
  geofence_radius_km: number;
  rate_limit_post_per_min: number;
  allow_guest_uploads: boolean;
}

export interface IntegrityVerifyResponse {
  id: string;
  valid: boolean;
  integrity_hash: string;
  recomputed_hash: string;
}

export interface ChatSourceSummary {
  id: string;
  title: string;
  location_name: string;
  category: Category;
  travel_advisory: TravelAdvisory;
  severity: number;
  verification_status: VerificationStatus;
  is_resolved: boolean;
}

export interface AiChatResponse {
  reply: string;
  referenced_posts_count: number;
  sources: ChatSourceSummary[];
  fallback_used: boolean;
}

export interface OfflineQueuedReport {
  localId: string;
  queuedAt: string;
  payload: CreatePostRequest;
}

export interface QuickLocation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom: number;
}

export interface UserCoords {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface GeocodeSuggestion {
  display_name: string;
  short_name: string;
  lat: number;
  lng: number;
  category: string | null;
  place_type: string | null;
}

export interface ReverseGeocodeResponse {
  display_name: string;
  short_name: string;
  lat: number;
  lng: number;
}
