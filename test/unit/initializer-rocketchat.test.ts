import { describe, expect, it, vi } from 'vitest';
import {
  normalizeBaseUrl,
  testAndDiscover,
} from '../../packages/create-rocketchat-mcp/src/rocketchat.js';

describe('initializer Rocket.Chat discovery', () => {
  it('validates credentials and separates rooms from DM contacts', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/me') {
        return Response.json({
          success: true,
          _id: 'bot-id',
          username: 'mcp-bot',
        });
      }
      return Response.json({
        success: true,
        update: [
          { _id: 's1', rid: 'GENERAL', name: 'general', t: 'c' },
          {
            _id: 's2',
            rid: 'PRIVATE',
            name: 'engineering',
            fname: 'Engineering',
            t: 'p',
          },
          { _id: 's3', rid: 'DM-ALICE', name: 'alice', t: 'd' },
        ],
      });
    });

    const result = await testAndDiscover(
      {
        baseUrl: 'https://chat.example.com',
        userId: 'bot-id',
        authToken: 'test-token',
        workspaceName: 'Facon',
      },
      fetchFn,
    );

    expect(result.username).toBe('mcp-bot');
    expect(result.rooms.map((room) => room.id)).toEqual(['PRIVATE', 'GENERAL']);
    expect(result.dmUsernames).toEqual(['alice']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('rejects insecure remote URLs but allows local HTTP', () => {
    expect(() => normalizeBaseUrl('http://chat.example.com')).toThrow(/HTTPS/);
    expect(normalizeBaseUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
  });
});
