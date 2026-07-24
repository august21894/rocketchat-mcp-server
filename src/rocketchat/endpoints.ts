/**
 * Rocket.Chat REST endpoint paths used by the MVP. Centralized so the client is
 * the single place that knows upstream URLs.
 */
export const ENDPOINTS = {
  info: '/api/info',
  me: '/api/v1/me',
  usersAutocomplete: '/api/v1/users.autocomplete',
  subscriptionsGet: '/api/v1/subscriptions.get',
  chatPostMessage: '/api/v1/chat.postMessage',
  chatSendMessage: '/api/v1/chat.sendMessage',
  chatGetMessage: '/api/v1/chat.getMessage',
  roomsMedia: (roomId: string) => `/api/v1/rooms.media/${encodeURIComponent(roomId)}`,
  roomsMediaConfirm: (roomId: string, fileId: string) =>
    `/api/v1/rooms.mediaConfirm/${encodeURIComponent(roomId)}/${encodeURIComponent(fileId)}`,
  roomsUpload: (roomId: string) => `/api/v1/rooms.upload/${encodeURIComponent(roomId)}`,
} as const;

/**
 * Build the `selector` query value for `users.autocomplete`. Rocket.Chat expects
 * a JSON-encoded object; we only ever send a plain search term (no deprecated
 * MongoDB query parameters).
 */
export function buildAutocompleteSelector(term: string): string {
  return JSON.stringify({ term, exceptions: [], conditions: {} });
}
