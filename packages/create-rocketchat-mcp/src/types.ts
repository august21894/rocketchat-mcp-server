export type AgentId = 'codex' | 'claude-code' | 'claude-desktop';
export type RoomAccess = 'selected' | 'all';
export type DmAccess = 'disabled' | 'selected' | 'all';
export type MentionPolicy = 'blocked' | 'here-only' | 'all';
export type UploadAccess = 'disabled' | 'selected' | 'all';
export type CredentialStorage = 'env-file' | 'client-config';

export interface Credentials {
  baseUrl: string;
  userId: string;
  authToken: string;
  workspaceName: string;
}

export interface DiscoveredRoom {
  id: string;
  name: string;
  displayName?: string;
  type: 'channel' | 'private_room';
  encrypted: boolean;
}

export interface ConnectionDiscovery {
  username: string;
  userId: string;
  rooms: DiscoveredRoom[];
  dmUsernames: string[];
}

export interface PolicySelection {
  roomAccess: RoomAccess;
  selectedRoomIds: string[];
  dmAccess: DmAccess;
  selectedDmUsers: string[];
  mentionPolicy: MentionPolicy;
  uploadAccess: UploadAccess;
  allowedUploadPaths: string[];
}

export interface ProfileInput extends Credentials, PolicySelection {}

export interface McpServerDefinition {
  command: string;
  args: string[];
  env: Record<string, string>;
}
