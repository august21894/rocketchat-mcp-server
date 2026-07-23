import { describe, it, expect } from 'vitest';
import { DestinationPolicy } from '../../src/policies/destination-policy.js';
import { MentionPolicy } from '../../src/policies/mention-policy.js';
import { ContentPolicy } from '../../src/policies/content-policy.js';
import { AppError } from '../../src/errors.js';

describe('DestinationPolicy', () => {
  const policy = new DestinationPolicy({
    allowedRooms: ['general', 'ROOMID123'],
    allowDm: true,
    allowedDmUsers: ['alice'],
  });

  it('allows a room by name (case-insensitive)', () => {
    expect(policy.isRoomAllowed({ id: 'x', name: 'General' })).toBe(true);
  });

  it('allows a room by id', () => {
    expect(policy.isRoomAllowed({ id: 'ROOMID123', name: 'whatever' })).toBe(true);
  });

  it('denies a room not on the allowlist', () => {
    expect(policy.isRoomAllowed({ id: 'y', name: 'random' })).toBe(false);
    expect(() => policy.assertRoomAllowed({ id: 'y', name: 'random' })).toThrowError(AppError);
  });

  it('treats an empty room allowlist as allow-any', () => {
    const open = new DestinationPolicy({ allowedRooms: [], allowDm: false, allowedDmUsers: [] });
    expect(open.isRoomAllowed({ id: 'anything', name: 'whatever' })).toBe(true);
    expect(() => open.assertRoomAllowed({ id: 'x', name: 'y' })).not.toThrow();
  });

  it('restricts to the room allowlist when it is non-empty', () => {
    const restricted = new DestinationPolicy({
      allowedRooms: ['general'],
      allowDm: false,
      allowedDmUsers: [],
    });
    expect(restricted.isRoomAllowed({ id: 'x', name: 'general' })).toBe(true);
    expect(restricted.isRoomAllowed({ id: 'x', name: 'random' })).toBe(false);
  });

  it('enforces the DM master switch and recipient allowlist', () => {
    expect(policy.isDmAllowed('alice')).toBe(true);
    expect(policy.isDmAllowed('bob')).toBe(false);
    expect(() => policy.assertDmAllowed('bob')).toThrowError(AppError);

    const noDm = new DestinationPolicy({
      allowedRooms: [],
      allowDm: false,
      allowedDmUsers: ['alice'],
    });
    expect(noDm.isDmAllowed('alice')).toBe(false);
    expect(() => noDm.assertDmAllowed('alice')).toThrowError(/disabled by policy/);
  });

  it('allows any recipient when DM is enabled and the DM allowlist is empty', () => {
    const openDm = new DestinationPolicy({ allowedRooms: [], allowDm: true, allowedDmUsers: [] });
    expect(openDm.isDmAllowed('anyone')).toBe(true);
    expect(openDm.isDmAllowed('someone-else')).toBe(true);
    expect(() => openDm.assertDmAllowed('anyone')).not.toThrow();
  });

  it('still requires the master switch even with an empty DM allowlist', () => {
    const off = new DestinationPolicy({ allowedRooms: [], allowDm: false, allowedDmUsers: [] });
    expect(off.isDmAllowed('anyone')).toBe(false);
    expect(() => off.assertDmAllowed('anyone')).toThrowError(/disabled by policy/);
  });
});

describe('MentionPolicy', () => {
  it('validates mention usernames', () => {
    const policy = new MentionPolicy({ allowHereMention: false, allowAllMention: false });
    expect(() => policy.validateUsernames(['alice', 'bob.smith', 'a_1-2'])).not.toThrow();
    expect(() => policy.validateUsernames(['bad name'])).toThrowError(AppError);
    expect(() => policy.validateUsernames(['a@b'])).toThrowError(/Invalid mention/);
  });

  it('renders user mentions as a prefix', () => {
    const policy = new MentionPolicy({ allowHereMention: false, allowAllMention: false });
    expect(
      policy.render({ text: 'Build done.', mentions: ['alice', 'bob'], groupMention: 'none' }),
    ).toBe('@alice @bob Build done.');
    expect(policy.render({ text: 'hi', mentions: [], groupMention: 'none' })).toBe('hi');
  });

  it('blocks disabled group mentions', () => {
    const policy = new MentionPolicy({ allowHereMention: false, allowAllMention: false });
    expect(() => policy.render({ text: 'x', mentions: [], groupMention: 'here' })).toThrowError(
      /@here.*disabled/,
    );
    expect(() => policy.render({ text: 'x', mentions: [], groupMention: 'all' })).toThrowError(
      /@all.*disabled/,
    );
  });

  it('renders enabled group mentions', () => {
    const policy = new MentionPolicy({ allowHereMention: true, allowAllMention: true });
    expect(policy.render({ text: 'x', mentions: [], groupMention: 'here' })).toBe('@here x');
    expect(policy.render({ text: 'x', mentions: ['a'], groupMention: 'all' })).toBe('@a @all x');
  });

  it('rejects literal @all/@here in text when disabled', () => {
    const policy = new MentionPolicy({ allowHereMention: false, allowAllMention: false });
    expect(() =>
      policy.render({ text: 'hello @all', mentions: [], groupMention: 'none' }),
    ).toThrowError(/@all/);
    expect(() =>
      policy.render({ text: '@here please', mentions: [], groupMention: 'none' }),
    ).toThrowError(/@here/);
  });

  it('does not false-positive on @all inside other words/emails', () => {
    const policy = new MentionPolicy({ allowHereMention: false, allowAllMention: false });
    expect(
      policy.render({ text: 'mail me@allison.example', mentions: [], groupMention: 'none' }),
    ).toContain('me@allison');
  });
});

describe('ContentPolicy', () => {
  it('normalizes line endings', () => {
    const policy = new ContentPolicy({ maxTextLength: 4000 });
    expect(policy.normalize('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('strips control characters but keeps tab and newline', () => {
    const policy = new ContentPolicy({ maxTextLength: 4000 });
    const out = policy.normalize('a\u0000bc\td\ne');
    expect(out).toBe('abc\td\ne');
  });

  it('rejects empty text', () => {
    const policy = new ContentPolicy({ maxTextLength: 4000 });
    expect(() => policy.normalize('   ')).toThrowError(/must not be empty/);
  });

  it('rejects text over the max length', () => {
    const policy = new ContentPolicy({ maxTextLength: 5 });
    expect(() => policy.normalize('123456')).toThrowError(/maximum length/);
    expect(policy.normalize('12345')).toBe('12345');
  });
});
