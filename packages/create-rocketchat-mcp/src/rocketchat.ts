import type { ConnectionDiscovery, Credentials, DiscoveredRoom } from './types.js';

interface MeResponse {
  _id: string;
  username: string;
  success?: boolean;
}

interface Subscription {
  rid: string;
  name: string;
  fname?: string;
  t: 'c' | 'p' | 'd';
  encrypted?: boolean;
}

interface SubscriptionsResponse {
  update?: Subscription[];
  success?: boolean;
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid URL, for example https://chat.example.com.');
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('HTTPS is required. HTTP is only allowed for localhost.');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export async function testAndDiscover(
  credentials: Credentials,
  fetchFn: typeof fetch = fetch,
): Promise<ConnectionDiscovery> {
  const me = await requestJson<MeResponse>(credentials, '/api/v1/me', fetchFn);
  const subscriptions = await requestJson<SubscriptionsResponse>(
    credentials,
    '/api/v1/subscriptions.get',
    fetchFn,
  );

  const rooms: DiscoveredRoom[] = [];
  const dmUsernames: string[] = [];
  for (const subscription of subscriptions.update ?? []) {
    if (subscription.t === 'd') {
      dmUsernames.push(subscription.name);
      continue;
    }
    const room: DiscoveredRoom = {
      id: subscription.rid,
      name: subscription.name,
      type: subscription.t === 'c' ? 'channel' : 'private_room',
      encrypted: subscription.encrypted === true,
    };
    if (subscription.fname && subscription.fname !== subscription.name) {
      room.displayName = subscription.fname;
    }
    rooms.push(room);
  }

  return {
    username: me.username,
    userId: me._id,
    rooms: rooms.sort((a, b) => a.name.localeCompare(b.name)),
    dmUsernames: Array.from(new Set(dmUsernames)).sort(),
  };
}

async function requestJson<T>(
  credentials: Credentials,
  path: string,
  fetchFn: typeof fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetchFn(credentials.baseUrl + path, {
      method: 'GET',
      headers: {
        'X-User-Id': credentials.userId,
        'X-Auth-Token': credentials.authToken,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Rocket.Chat did not respond within 10 seconds.');
    }
    throw new Error('Could not reach Rocket.Chat. Check the URL and network connection.');
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => undefined)) as
    { success?: boolean; error?: string; message?: string } | undefined;
  if (!response.ok || body?.success === false) {
    const upstream = body?.error ?? body?.message;
    const suffix = upstream ? `: ${upstream}` : '';
    throw new Error(`Rocket.Chat returned HTTP ${response.status}${suffix}`);
  }
  return body as T;
}
