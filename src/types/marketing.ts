import type { Audience, DateOnly, FileRef, HistoryEntry, ID, ISODateTime } from "./common";

export type ContentType = "arte" | "video" | "reels" | "story" | "carrossel" | "texto" | "outro";

export type ContentStatus = "briefing" | "production" | "review" | "approved" | "published" | "cancelled";

export type Channel = "instagram_feed" | "instagram_stories" | "tiktok" | "whatsapp" | "mural" | "outro";

export interface ContentLink {
  label: string;
  url: string;
}

export interface ContentItem {
  id: ID;
  code: string;
  title: string;
  type: ContentType;
  campaignId?: ID;
  eventId?: ID;
  responsibleId: ID;
  publishDate?: DateOnly;
  channels: Channel[];
  briefing: string;
  notes?: string;
  links: ContentLink[];
  files: FileRef[];
  status: ContentStatus;
  access: Audience;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}
