/**
 * A hand-rolled fake of RocketChatClient for unit tests that only need canned
 * responses (target resolver, room/user services).
 */
import type { RocketChatClient } from '../../src/rocketchat/client.js';
import type {
  RcAutocompleteUser,
  RcMeResponse,
  RcMessage,
  RcSubscription,
} from '../../src/rocketchat/types.js';

export interface FakeClientState {
  baseUrl?: string;
  me?: RcMeResponse;
  autocomplete?: RcAutocompleteUser[];
  subscriptions?: RcSubscription[];
  messages?: Record<string, RcMessage>;
}

export function makeFakeClient(state: FakeClientState = {}): RocketChatClient {
  const fake = {
    baseUrl: state.baseUrl ?? 'https://chat.example.com',
    async me(): Promise<RcMeResponse> {
      return state.me ?? { success: true, _id: 'bot-user-id', username: 'coding-agent' };
    },
    async usersAutocomplete(): Promise<RcAutocompleteUser[]> {
      return state.autocomplete ?? [];
    },
    async subscriptionsGet(): Promise<RcSubscription[]> {
      return state.subscriptions ?? [];
    },
    async chatGetMessage(msgId: string): Promise<RcMessage> {
      const msg = state.messages?.[msgId];
      if (!msg) throw new Error(`no message ${msgId}`);
      return msg;
    },
  };
  return fake as unknown as RocketChatClient;
}
