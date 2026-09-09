/**
 * Response shapes returned by the API and consumed by the web client.
 *
 * These describe only what is safe to expose publicly. Nothing here carries a
 * password hash, a token, or an email address: `email` appears on the
 * authenticated `MeDto` alone, never on a public profile.
 */

import type {
  ApplicationStatus,
  CommissionStatus,
  LinkPlatform,
  NotificationType,
  PostingStatus,
  ReactionKind,
  UserRole,
} from "./constants.js";

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImageDto {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface CategoryDto {
  slug: string;
  name: string;
  description: string;
}

export interface ExternalLinkDto {
  platform: LinkPlatform;
  url: string;
  label?: string;
}

/** The compact user shape embedded in postings, applications and reviews. */
export interface UserSummaryDto {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  avatar: ImageDto | null;
  region?: string;
  city?: string;
}

export interface RatingSummaryDto {
  average: number | null;
  count: number;
}

export interface PublicProfileDto extends UserSummaryDto {
  bio?: string;
  cover: ImageDto | null;
  createdAt: string;
  rating: RatingSummaryDto;
  completedCommissions: number;
  links: ExternalLinkDto[];
  /** Present only when role is "artist". */
  artist?: {
    headline?: string;
    acceptingCommissions: boolean;
    categories: CategoryDto[];
    skills: string[];
  };
}

/** The authenticated user's own record. The only shape carrying an email. */
export interface MeDto extends PublicProfileDto {
  email: string;
}

export interface PostingDto {
  id: string;
  title: string;
  description: string;
  category: CategoryDto;
  minBudgetCentavos: number;
  requirements?: string;
  deadline?: string;
  status: PostingStatus;
  images: ImageDto[];
  client: UserSummaryDto;
  applicationCount: number;
  /** Present only for the posting owner and the selected artist. */
  commissionId?: string;
  /** Present only when the viewer is an artist who has already applied. */
  viewerApplicationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationDto {
  id: string;
  postingId: string;
  artist: UserSummaryDto;
  proposedPriceCentavos: number;
  coverLetter: string;
  status: ApplicationStatus;
  samples: ArtistPostSummaryDto[];
  artistRating: RatingSummaryDto;
  createdAt: string;
}

export interface ArtistPostSummaryDto {
  id: string;
  caption: string;
  coverImage: ImageDto | null;
  category?: CategoryDto;
}

export interface ArtistPostDto extends ArtistPostSummaryDto {
  description?: string;
  images: ImageDto[];
  artist: UserSummaryDto;
  createdAt: string;
  reactions: ReactionSummary;
  commentCount: number;
  /** Whether the signed-in viewer saved this. Absent when signed out. */
  saved?: boolean;
}

/**
 * Counts per kind, plus what the viewer themselves chose.
 *
 * `mine` is what lets the reaction bar show its own state without a second
 * request, and it is null for a signed-out reader rather than absent, so the
 * client never has to tell "not loaded" from "not reacted".
 */
export interface ReactionSummary {
  love: number;
  support: number;
  like: number;
  total: number;
  mine: ReactionKind | null;
}

export interface CommentDto {
  id: string;
  body: string;
  author: UserSummaryDto;
  createdAt: string;
  /** True when the viewer wrote it, so the client can offer to delete. */
  mine: boolean;
}

/** One search over artists, clients, portfolio posts and open requests. */
export interface SearchResultsDto {
  artists: UserSummaryDto[];
  clients: UserSummaryDto[];
  posts: ArtistPostSummaryDto[];
  requests: { id: string; title: string; minBudgetCentavos: number; category: CategoryDto }[];
}

export interface CommissionDto {
  id: string;
  posting: { id: string; title: string; status: PostingStatus };
  client: UserSummaryDto;
  artist: UserSummaryDto;
  agreedPriceCentavos: number;
  status: CommissionStatus;
  startedAt: string;
  completedAt?: string;
  /** Whether the requesting user still owes a review on this commission. */
  canReview: boolean;
  reviews: ReviewDto[];
}

export interface ReviewDto {
  id: string;
  commissionId: string;
  reviewer: UserSummaryDto;
  revieweeId: string;
  rating: number;
  body?: string;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** Consistent error envelope for every non-2xx response. */
export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    /** Field-level messages, keyed by dotted path, for form display. */
    fields?: Record<string, string>;
  };
}
