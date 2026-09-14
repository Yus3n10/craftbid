/**
 * Response shapes returned by the API and consumed by the web client.
 *
 * These describe only what is safe to expose publicly. Nothing here carries a
 * password hash, a token, or an email address: `email` appears on the
 * authenticated `MeDto` and the staff-only admin shapes, never on a public
 * profile.
 */

import type {
  ApplicationStatus,
  BalanceMethod,
  BugReportStatus,
  CommissionStatus,
  LinkPlatform,
  ModerationAction,
  ModerationRule,
  NotificationType,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  PostingStatus,
  ProblemReason,
  ProblemStatus,
  ReactionKind,
  ReportStatus,
  ReportTargetType,
  TransferMethod,
  UserRole,
  UserStatus,
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
  /**
   * False only while email verification is switched on and this address has
   * not been proved. Unverified accounts can sign in and browse, and are
   * refused posting, bidding and the social actions until they verify.
   */
  emailVerified: boolean;
  /** Staff can open the admin screen. Granted only from the command line. */
  isStaff: boolean;
}

/** What /auth/register answers when the account must verify first. */
export interface VerificationSentDto {
  status: "verification_sent";
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
  /** The client's starting budget when this bid was made. */
  startingBudgetCentavos: number;
  /** Present only when the bid is below the starting budget. */
  belowBudgetReason?: string;
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
  /** How many people shared this post to their profile. */
  shareCount: number;
  /** Whether the signed-in viewer shared it. Absent when signed out. */
  shared?: boolean;
}

/**
 * Someone sharing a post to their profile. The post keeps its own artist, so
 * a share can never present the work as the sharer's.
 */
export interface ShareDto {
  id: string;
  user: UserSummaryDto;
  caption?: string;
  createdAt: string;
  /** The share's own reactions, not the shared post's. */
  reactions: ReactionSummary;
  /** Comments on the share itself. */
  commentCount: number;
}

/**
 * One card in the feed or on a profile's shared list: a post, and when it is
 * there because somebody shared it, who and what they said.
 */
export interface FeedItemDto extends ArtistPostDto {
  share?: ShareDto;
}

/**
 * An open craft request as the home feed shows it. Without the bid count or
 * the commission: a request in a public feed must say nothing about bidding.
 */
export type HomeRequestDto = Omit<PostingDto, "applicationCount" | "commissionId">;

/** One card in the home feed: a post (or a share of one), or an open request. */
export type HomeItemDto = ({ kind: "post" } & FeedItemDto) | ({ kind: "request" } & HomeRequestDto);

export const ACTIVITY_KINDS = ["reaction", "comment", "save", "share"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * One line of someone's own activity history: what they did, to which post,
 * and when. Visible only to that person.
 */
export interface ActivityItemDto {
  kind: ActivityKind;
  at: string;
  post: ArtistPostSummaryDto & { artist: UserSummaryDto };
  /** The reaction chosen, for kind "reaction". */
  reaction?: ReactionKind;
  /** For kind "comment": the comment, so it can be read and removed. */
  comment?: { id: string; body: string };
  /** For kind "share": what they wrote with it. */
  caption?: string;
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
  /**
   * Present on commissions started after payment records were introduced.
   * Older commissions have none and keep the original flow.
   */
  paymentTracking?: PaymentTrackingDto;
}

export interface PayoutAccountDto {
  method: TransferMethod;
  accountName: string;
  accountNumber: string;
  bankName?: string;
}

export interface CommissionPaymentDto {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCentavos: number;
  /** Transfers only. */
  referenceNumber?: string;
  paidOn?: string;
  receiptFileId?: string;
  /** The account the client says they paid, as it was at that moment. */
  paidTo?: PayoutAccountDto;
  recordedBy: "client" | "artist";
  submittedAt: string;
  decidedAt?: string;
}

export interface CommissionProblemDto {
  id: string;
  reason: ProblemReason;
  details: string;
  status: ProblemStatus;
  openedBy: "client" | "artist";
  openedByViewer: boolean;
  resolution?: string;
  createdAt: string;
  closedAt?: string;
}

/**
 * Where a tracked commission stands, from the two payments and the work.
 * Computed on the server so the client and the API cannot disagree about what
 * is allowed next.
 */
export type PaymentStage =
  | "awaiting_down_payment"
  | "down_payment_submitted"
  | "in_progress"
  | "awaiting_balance"
  | "balance_submitted"
  | "ready_to_complete";

export interface PaymentTrackingDto {
  downPaymentCentavos: number;
  balanceCentavos: number;
  balanceMethod: BalanceMethod;
  stage: PaymentStage;
  /** Newest first, rejected ones included, so the history is visible. */
  payments: CommissionPaymentDto[];
  finishedAt?: string;
  finishedPhotoIds: string[];
  shipping?: { courier: string; trackingNumber?: string; shippedAt: string };
  openProblem?: CommissionProblemDto;
  problems: CommissionProblemDto[];
  /** The artist's current payment details. */
  payTo: PayoutAccountDto[];
}

export interface ReviewDto {
  id: string;
  commissionId: string;
  reviewer: UserSummaryDto;
  revieweeId: string;
  /** Which side the reviewer was on in that commission, whatever their role is now. */
  reviewerRoleInCommission: UserRole;
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

export interface RoleSwitchStatusDto {
  allowed: boolean;
  /** Plain sentences, one per reason the switch is refused. */
  blockers: string[];
  /** When the cooldown ends, if it is the reason. */
  nextAllowedAt: string | null;
}

export interface AdminOverviewDto {
  openReports: number;
  openBugReports: number;
  suspendedAccounts: number;
  unconfirmedAccounts: number;
  actionsThisWeek: number;
}

export interface AdminUserRowDto {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  isStaff: boolean;
  createdAt: string;
  /** Null when the account never confirmed its email. */
  emailConfirmedAt: string | null;
}

export interface ModerationActionDto {
  id: string;
  action: ModerationAction;
  targetType: string;
  targetId: string;
  subjectUser: { id: string; username: string } | null;
  staff: { id: string; username: string };
  rule: ModerationRule | null;
  note: string | null;
  createdAt: string;
}

export interface AdminContentItemDto {
  id: string;
  kind: "artist_post" | "posting" | "comment";
  text: string;
  createdAt: string;
  removed: boolean;
  /** Where it can be seen on the site, when it still can. */
  href: string | null;
}

export interface AdminUserDetailDto extends AdminUserRowDto {
  bio: string | null;
  history: ModerationActionDto[];
  reportsAgainst: { id: string; reason: string; status: ReportStatus; createdAt: string }[];
  recentContent: AdminContentItemDto[];
}

export interface AdminReportDto {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reporter: { id: string; username: string };
  /** What was reported, as it is now. Null when it no longer exists. */
  target: {
    text: string;
    href: string | null;
    removed: boolean;
    owner: { id: string; username: string } | null;
  } | null;
  resolution: { note: string | null; at: string; by: string } | null;
}

export interface AdminBugReportDto {
  id: string;
  description: string;
  pageUrl: string | null;
  userAgent: string | null;
  hasScreenshot: boolean;
  status: BugReportStatus;
  createdAt: string;
  reporter: { id: string; username: string; email: string };
}

/** One conversation, as the person in it sees it. Never carries a bid's price. */
export interface ConversationDto {
  id: string;
  posting: { id: string; title: string };
  /** The other person in the conversation. */
  otherParty: UserSummaryDto;
  myRole: "client" | "artist";
  /** Still a bid, or a commission with this artist. */
  stage: "bidding" | "commission";
  commissionId?: string;
  /** False once the bid was declined or withdrawn, or the commission cancelled. */
  canSend: boolean;
}

export interface MessageDto {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface ConversationSummaryDto {
  id: string;
  posting: { id: string; title: string };
  otherParty: UserSummaryDto;
  myRole: "client" | "artist";
  lastMessage: { body: string; createdAt: string; mine: boolean };
  unread: boolean;
}
