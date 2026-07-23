/**
 * Mention policy — user mentions and gated group mentions (`@here` / `@all`).
 *
 *   - Only syntactically valid usernames may be mentioned.
 *   - `@here` and `@all` require their respective feature flags.
 *   - Text is NOT silently converted: if it already contains `@all`/`@here`
 *     while that group mention is disabled, the request is rejected rather than
 *     letting Rocket.Chat expand it server-side.
 */
import { AppError } from '../errors.js';
import type { AppConfig } from '../config/schema.js';

export type GroupMention = 'none' | 'here' | 'all';

/** Valid Rocket.Chat usernames: letters, digits, dot, dash, underscore. */
const USERNAME_PATTERN = /^[0-9a-zA-Z._-]{1,100}$/;

/** Detect a literal `@here` / `@all` token (word-boundary aware). */
const HERE_TOKEN = /(^|[^0-9a-zA-Z._-])@here\b/;
const ALL_TOKEN = /(^|[^0-9a-zA-Z._-])@all\b/;

export interface RenderMentionsInput {
  text: string;
  mentions: string[];
  groupMention: GroupMention;
}

export class MentionPolicy {
  private readonly allowHere: boolean;
  private readonly allowAll: boolean;

  constructor(config: Pick<AppConfig, 'allowHereMention' | 'allowAllMention'>) {
    this.allowHere = config.allowHereMention;
    this.allowAll = config.allowAllMention;
  }

  /** Validate mention usernames; throws `invalid_input` on a malformed name. */
  validateUsernames(usernames: string[]): void {
    for (const username of usernames) {
      if (!USERNAME_PATTERN.test(username)) {
        throw new AppError('invalid_input', `Invalid mention username: "${username}".`, {
          retryable: false,
        });
      }
    }
  }

  /** Throw `mention_not_allowed` for a disabled group mention. */
  private assertGroupMentionAllowed(groupMention: GroupMention): void {
    if (groupMention === 'here' && !this.allowHere) {
      throw new AppError('mention_not_allowed', '@here mentions are disabled by policy.', {
        retryable: false,
      });
    }
    if (groupMention === 'all' && !this.allowAll) {
      throw new AppError('mention_not_allowed', '@all mentions are disabled by policy.', {
        retryable: false,
      });
    }
  }

  /**
   * Reject text that would trigger a disabled group mention when Rocket.Chat
   * parses it server-side.
   */
  private assertNoDisallowedGroupMentionInText(text: string): void {
    if (!this.allowHere && HERE_TOKEN.test(text)) {
      throw new AppError(
        'mention_not_allowed',
        'Message text contains "@here" but @here mentions are disabled by policy.',
        { retryable: false },
      );
    }
    if (!this.allowAll && ALL_TOKEN.test(text)) {
      throw new AppError(
        'mention_not_allowed',
        'Message text contains "@all" but @all mentions are disabled by policy.',
        { retryable: false },
      );
    }
  }

  /**
   * Render the final message text: `@user` prefixes, an optional group mention,
   * then the body. Enforces every mention rule as a side effect.
   */
  render(input: RenderMentionsInput): string {
    this.validateUsernames(input.mentions);
    this.assertGroupMentionAllowed(input.groupMention);
    this.assertNoDisallowedGroupMentionInText(input.text);

    const prefixTokens = input.mentions.map((u) => `@${u}`);
    if (input.groupMention === 'here') prefixTokens.push('@here');
    if (input.groupMention === 'all') prefixTokens.push('@all');

    if (prefixTokens.length === 0) {
      return input.text;
    }
    return `${prefixTokens.join(' ')} ${input.text}`;
  }
}
