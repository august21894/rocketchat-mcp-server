/**
 * Minimal typings for the subset of the Rocket.Chat REST API used by the MVP.
 * Only fields we actually consume are declared; upstream returns much more.
 */

/** Rocket.Chat room type discriminator. */
export type RcRoomType = 'c' | 'p' | 'd';

/** Normalized room type exposed through MCP tools. */
export type NormalizedRoomType = 'channel' | 'private_room' | 'direct';

export const ROOM_TYPE_MAP: Record<RcRoomType, NormalizedRoomType> = {
  c: 'channel',
  p: 'private_room',
  d: 'direct',
};

export interface RcUserBrief {
  _id: string;
  username?: string;
  name?: string;
}

/** Item shape from `GET /api/v1/users.autocomplete`. */
export interface RcAutocompleteUser {
  _id: string;
  username: string;
  name?: string;
  nickname?: string;
  status?: string;
}

export interface RcAutocompleteResponse {
  items: RcAutocompleteUser[];
  success: boolean;
}

/** Subscription shape from `GET /api/v1/subscriptions.get`. */
export interface RcSubscription {
  _id: string;
  rid: string;
  name: string;
  fname?: string;
  t: RcRoomType;
  open?: boolean;
  /** Present and true when the underlying room is end-to-end encrypted. */
  encrypted?: boolean;
  /** DM subscriptions carry the list of member usernames. */
  usernames?: string[];
  u?: RcUserBrief;
}

export interface RcSubscriptionsResponse {
  update?: RcSubscription[];
  remove?: RcSubscription[];
  success: boolean;
}

/** Authenticated identity from `GET /api/v1/me`. */
export interface RcMeResponse {
  _id: string;
  username: string;
  name?: string;
  status?: string;
  roles?: string[];
  success: boolean;
}

/** A message object as returned by chat.* endpoints. */
export interface RcMessage {
  _id: string;
  rid: string;
  msg: string;
  ts: string;
  u: RcUserBrief;
  /** True when the message lives inside an encrypted room. */
  t?: string;
  editedAt?: string;
}

export interface RcMessageResponse {
  message: RcMessage;
  success: boolean;
}

/** First-step response from `POST /rooms.media/:rid`. */
export interface RcMediaUploadResponse {
  file: {
    _id: string;
    url: string;
  };
  success: boolean;
}

/** Allow-listed fields for the second-step media confirmation request. */
export interface RcMediaConfirmPayload {
  description?: string;
  msg?: string;
  tmid?: string;
}

/** Outbound payload for chat.postMessage / chat.sendMessage (allow-listed fields only). */
export interface RcPostMessagePayload {
  channel?: string;
  roomId?: string;
  text: string;
  parseUrls?: boolean;
}

export interface RcSendMessagePayload {
  message: {
    _id?: string;
    rid: string;
    msg: string;
    /** Parent message id for a thread reply. */
    tmid?: string;
    parseUrls?: boolean;
  };
}
