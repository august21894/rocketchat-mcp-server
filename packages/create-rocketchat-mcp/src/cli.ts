#!/usr/bin/env node
import * as p from '@clack/prompts';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute } from 'node:path';
import { FileTransaction, configureAgent } from './agents.js';
import { installRuntime } from './install.js';
import { profilePath, resolveAgentPaths, resolveAppPaths, type AgentPath } from './paths.js';
import {
  buildProfileEnvironment,
  parseProfileEnvironment,
  renderProfileEnvironment,
  serverNameForProfile,
  slugifyProfile,
} from './profile.js';
import { normalizeBaseUrl, testAndDiscover } from './rocketchat.js';
import type {
  AgentId,
  ConnectionDiscovery,
  CredentialStorage,
  Credentials,
  DmAccess,
  MentionPolicy,
  ProfileInput,
  RoomAccess,
  UploadAccess,
} from './types.js';

interface CliOptions {
  dryRun: boolean;
  skipConnectionTest: boolean;
}

interface ExistingProfile {
  name: string;
  env: Record<string, string>;
}

const PACKAGE_METADATA = readPackageMetadata();
const VERSION = PACKAGE_METADATA.version;
const RUNTIME_VERSION = PACKAGE_METADATA.runtimeVersion;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive setup requires a terminal. Run with a TTY or use the existing manual configuration flow.',
    );
  }

  const context = { platform: process.platform, homedir: homedir(), env: process.env };
  const paths = resolveAppPaths(context);
  const agents = resolveAgentPaths(context);

  p.intro(`Rocket.Chat MCP Setup  v${VERSION}`);
  p.note(
    `Node.js ${process.version} · ${process.platform} ${process.arch}\n` +
      'The initializer runs temporarily; the MCP runtime will be installed at a stable location.',
    'Environment',
  );

  const existingProfiles = loadExistingProfiles(paths.profilesDir);
  const existing = await chooseExistingProfile(existingProfiles);
  const current = existing?.env ?? {};

  p.note(
    'Select every MCP client that should receive this profile.\n' +
      'Each existing configuration is backed up before it is changed.',
    'MCP clients',
  );
  const selectedAgentIds = promptValue(
    await p.multiselect({
      message: 'Select MCP clients',
      options: agents.map((agent) => ({
        value: agent.id,
        label: agent.label,
        hint: `${existsSync(agent.configPath) ? 'detected' : 'config will be created'} · ${agent.configPath}`,
      })),
      initialValues: detectedAgentDefaults(agents),
      required: true,
    }),
  ) as AgentId[];

  const baseUrl =
    promptValue(
      await p.text({
        message: 'Rocket.Chat workspace URL',
        placeholder: 'https://chat.example.com',
        ...(current.ROCKETCHAT_BASE_URL ? { initialValue: current.ROCKETCHAT_BASE_URL } : {}),
        validate(value) {
          try {
            normalizeBaseUrl(value ?? '');
          } catch (error) {
            return error instanceof Error ? error.message : 'Enter a valid Rocket.Chat URL.';
          }
        },
      }),
    ) ?? '';
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  const workspaceName =
    promptValue(
      await p.text({
        message: 'Workspace display name',
        placeholder: 'Facon',
        initialValue: current.ROCKETCHAT_WORKSPACE_NAME ?? new URL(normalizedBaseUrl).hostname,
        validate(value) {
          const trimmed = (value ?? '').trim();
          if (!trimmed) return 'Workspace name is required.';
          if (trimmed.length > 80) return 'Workspace name must be at most 80 characters.';
          if (hasControlCharacters(trimmed)) {
            return 'Workspace name must not contain control characters.';
          }
        },
      }),
    )?.trim() ?? '';

  const profileName = existing
    ? existing.name
    : (promptValue(
        await p.text({
          message: 'Profile name',
          placeholder: slugifyProfile(workspaceName),
          initialValue: slugifyProfile(workspaceName),
          validate(value) {
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test((value ?? '').trim())) {
              return 'Use 1–40 letters, numbers, dots, underscores or hyphens.';
            }
          },
        }),
      )?.trim() ?? '');

  const userId =
    promptValue(
      await p.text({
        message: 'Bot User ID',
        placeholder: 'bot-user-id',
        ...(current.ROCKETCHAT_USER_ID ? { initialValue: current.ROCKETCHAT_USER_ID } : {}),
        validate(value) {
          if (!(value ?? '').trim()) return 'Bot User ID is required.';
        },
      }),
    )?.trim() ?? '';

  const existingToken = current.ROCKETCHAT_AUTH_TOKEN ?? '';
  const enteredToken = promptValue(
    await p.password({
      message: existingToken
        ? 'Personal Access Token (leave empty to keep the existing token)'
        : 'Personal Access Token',
      mask: '•',
      validate(value) {
        if (!existingToken && !(value ?? '').trim()) return 'Personal Access Token is required.';
      },
    }),
  );
  const authToken = (enteredToken ?? '').trim() || existingToken;
  const credentials: Credentials = {
    baseUrl: normalizedBaseUrl,
    userId,
    authToken,
    workspaceName,
  };

  let discovery: ConnectionDiscovery | undefined;
  if (!options.skipConnectionTest) {
    discovery = await connectWithRetry(credentials);
  } else {
    p.log.warn('Connection test skipped. Room IDs will need to be entered manually.');
  }

  const policy = await collectPolicy(current, discovery);
  const storage = await collectCredentialStorage();
  const selectedAgents = agents.filter((agent) => selectedAgentIds.includes(agent.id));
  const serverName = serverNameForProfile(profileName);
  const envPath = profilePath(paths, profileName);

  const previewInstall = await installRuntime({
    runtimeDir: paths.runtimeDir,
    runtimeVersion: RUNTIME_VERSION,
    dryRun: true,
  });

  p.note(
    [
      `Workspace       ${workspaceName} · ${normalizedBaseUrl}`,
      `Bot             ${discovery ? `@${discovery.username}` : userId}`,
      `MCP clients     ${selectedAgents.map((agent) => agent.label).join(', ')}`,
      `Room access     ${describeRoomPolicy(policy.roomAccess, policy.selectedRoomIds, discovery)}`,
      `Direct messages ${describeDmPolicy(policy.dmAccess, policy.selectedDmUsers)}`,
      `Group mentions  ${describeMentionPolicy(policy.mentionPolicy)}`,
      `File uploads    ${describeUploadPolicy(policy.uploadAccess, policy.allowedUploadPaths)}`,
      `Credentials     ${
        storage === 'env-file' ? `Dedicated profile · ${envPath}` : 'Plaintext MCP client config'
      }`,
      `Runtime         Managed user installation · ${previewInstall.packageSpec}`,
      `Server name     ${serverName}`,
      '',
      options.dryRun
        ? 'Dry run: no files or packages will be changed.'
        : 'No configuration has been changed yet.',
    ].join('\n'),
    'Review configuration',
  );

  const confirmed = promptValue(
    await p.confirm({
      message: options.dryRun ? 'Finish this dry run?' : 'Install and apply this configuration?',
      initialValue: false,
    }),
  );
  if (!confirmed) {
    p.cancel('Setup cancelled. Nothing was changed.');
    return;
  }
  if (options.dryRun) {
    p.outro('Dry run complete. Nothing was changed.');
    return;
  }

  const installSpinner = p.spinner();
  installSpinner.start(`Installing ${previewInstall.packageSpec}`);
  let runtime;
  try {
    runtime = await installRuntime({
      runtimeDir: paths.runtimeDir,
      runtimeVersion: RUNTIME_VERSION,
      dryRun: false,
    });
    installSpinner.stop(`Runtime installed · ${runtime.serverPath}`);
  } catch (error) {
    installSpinner.stop('Runtime installation failed');
    throw error;
  }

  const profileInput: ProfileInput = { ...credentials, ...policy };
  const profileEnv = buildProfileEnvironment(profileInput);
  const definitionEnv = storage === 'env-file' ? { ROCKETCHAT_ENV_FILE: envPath } : profileEnv;
  const definition = {
    command: process.execPath,
    args: [runtime.serverPath],
    env: definitionEnv,
  };

  const transaction = new FileTransaction();
  const configSpinner = p.spinner();
  configSpinner.start('Writing profile and MCP client configuration');
  try {
    if (storage === 'env-file') {
      transaction.write(envPath, renderProfileEnvironment(profileEnv), 0o600);
    }
    for (const agent of selectedAgents) {
      configureAgent(agent, serverName, definition, transaction);
    }
    configSpinner.stop('Configuration written and backups created');
  } catch (error) {
    transaction.rollback();
    configSpinner.stop('Configuration failed; previous files were restored');
    throw error;
  }

  if (transaction.backups.length > 0) {
    p.note(transaction.backups.join('\n'), 'Backups');
  }
  p.note(
    selectedAgents.map((agent) => `• ${agent.label}: ${agent.restartNote}`).join('\n'),
    'Next steps',
  );
  p.outro(`Rocket.Chat MCP profile "${profileName}" is ready.`);
}

async function chooseExistingProfile(
  profiles: ExistingProfile[],
): Promise<ExistingProfile | undefined> {
  if (profiles.length === 0) return undefined;
  p.note(
    'An existing profile can be updated without re-entering its token.\n' +
      'Changing clients or policies will preserve unrelated client configuration.',
    'Existing installation detected',
  );
  const choice = promptValue(
    await p.select({
      message: 'What would you like to configure?',
      options: [
        {
          value: '__new__',
          label: 'Add another workspace',
          hint: 'create an independent profile and MCP server',
        },
        ...profiles.map((profile) => ({
          value: profile.name,
          label: `Update "${profile.name}"`,
          hint: profile.env.ROCKETCHAT_BASE_URL ?? 'existing profile',
        })),
      ],
    }),
  );
  return choice === '__new__' ? undefined : profiles.find((profile) => profile.name === choice);
}

async function connectWithRetry(
  credentials: Credentials,
): Promise<ConnectionDiscovery | undefined> {
  for (;;) {
    const spinner = p.spinner();
    spinner.start('Testing connection and discovering joined rooms');
    try {
      const discovery = await testAndDiscover(credentials);
      spinner.stop(
        `Connected as @${discovery.username} · ${String(discovery.rooms.length)} joined rooms`,
      );
      return discovery;
    } catch (error) {
      spinner.stop('Connection test failed');
      p.log.error(error instanceof Error ? error.message : String(error));
      const action = promptValue(
        await p.select({
          message: 'How should setup continue?',
          options: [
            {
              value: 'retry',
              label: 'Retry connection',
              hint: 'try the same URL and credentials again',
            },
            {
              value: 'continue',
              label: 'Continue with manual room IDs',
              hint: 'configuration can be created, but credentials remain unverified',
            },
            {
              value: 'cancel',
              label: 'Cancel setup',
              hint: 'no files or packages have been changed',
            },
          ],
        }),
      );
      if (action === 'retry') continue;
      if (action === 'continue') return undefined;
      p.cancel('Setup cancelled. Nothing was changed.');
      process.exit(0);
    }
  }
}

async function collectPolicy(
  current: Record<string, string>,
  discovery: ConnectionDiscovery | undefined,
): Promise<{
  roomAccess: RoomAccess;
  selectedRoomIds: string[];
  dmAccess: DmAccess;
  selectedDmUsers: string[];
  mentionPolicy: MentionPolicy;
  uploadAccess: UploadAccess;
  allowedUploadPaths: string[];
}> {
  p.note(
    'All joined rooms means every room the bot belongs to now and rooms it joins later.\n' +
      'It does not grant the bot access to rooms it has not joined.',
    'Room access',
  );
  const currentRooms = splitCsv(current.ROCKETCHAT_ALLOWED_ROOMS);
  const roomAccess = promptValue(
    await p.select({
      message: 'Which rooms may this MCP send messages to?',
      options: [
        {
          value: 'selected',
          label: 'Selected rooms',
          hint: 'recommended · new rooms stay blocked until explicitly allowed',
        },
        {
          value: 'all',
          label: 'All joined rooms',
          hint: 'includes rooms the bot joins in the future',
        },
      ],
      initialValue: current.ROCKETCHAT_ALLOWED_ROOMS === '' ? 'all' : 'selected',
    }),
  ) as RoomAccess;

  let selectedRoomIds: string[] = [];
  if (roomAccess === 'selected' && discovery && discovery.rooms.length > 0) {
    selectedRoomIds = promptValue(
      await p.multiselect({
        message: 'Select allowed rooms',
        options: discovery.rooms.map((room) => ({
          value: room.id,
          label: `${room.type === 'channel' ? '#' : '🔒 '}${room.displayName ?? room.name}`,
          hint: `${room.type === 'channel' ? 'public channel' : 'private room'} · ID ${room.id}${
            room.encrypted ? ' · encrypted' : ''
          }`,
        })),
        initialValues: currentRooms.filter((roomId) =>
          discovery.rooms.some((room) => room.id === roomId),
        ),
        required: true,
      }),
    ) as string[];
  } else if (roomAccess === 'selected') {
    const manual = promptValue(
      await p.text({
        message: 'Allowed room IDs (comma-separated)',
        placeholder: 'GENERAL7xA,ENG9kP2',
        initialValue: currentRooms.join(','),
        validate(value) {
          if (splitCsv(value).length === 0) return 'Enter at least one room ID.';
        },
      }),
    );
    selectedRoomIds = splitCsv(manual);
  }

  p.note(
    'Disabling DMs prevents every direct message.\n' +
      'Selected users creates an explicit username allowlist; “any user” permits all resolved users.',
    'Direct messages',
  );
  const currentDmUsers = splitCsv(current.ROCKETCHAT_ALLOWED_DM_USERS);
  const currentDmAccess: DmAccess =
    Object.keys(current).length === 0 || current.ROCKETCHAT_ALLOW_DM === 'false'
      ? 'disabled'
      : currentDmUsers.length > 0
        ? 'selected'
        : 'all';
  const dmAccess = promptValue(
    await p.select({
      message: 'Who may receive direct messages?',
      options: [
        {
          value: 'disabled',
          label: 'Disable direct messages',
          hint: 'recommended · all DM attempts are rejected',
        },
        {
          value: 'selected',
          label: 'Selected users',
          hint: 'only explicitly listed usernames may receive DMs',
        },
        {
          value: 'all',
          label: 'Any workspace user',
          hint: 'higher risk · a mistaken username may contact the wrong person',
        },
      ],
      initialValue: currentDmAccess,
    }),
  ) as DmAccess;

  let selectedDmUsers: string[] = [];
  if (dmAccess === 'selected') {
    const suggested = currentDmUsers.length > 0 ? currentDmUsers : (discovery?.dmUsernames ?? []);
    const usernames = promptValue(
      await p.text({
        message: 'Allowed DM usernames (comma-separated, without @)',
        placeholder: 'alice,bob',
        initialValue: suggested.join(','),
        validate(value) {
          if (splitCsv(value).length === 0) return 'Enter at least one username.';
        },
      }),
    );
    selectedDmUsers = splitCsv(usernames).map((value) => value.replace(/^@/, ''));
  }

  p.note(
    '@here can notify active room members. @all can notify every room member.\n' +
      'Messages containing a blocked mention are rejected before reaching Rocket.Chat.',
    'Group mentions',
  );
  const currentMentionPolicy: MentionPolicy =
    current.ROCKETCHAT_ALLOW_ALL_MENTION === 'true'
      ? 'all'
      : current.ROCKETCHAT_ALLOW_HERE_MENTION === 'true'
        ? 'here-only'
        : 'blocked';
  const mentionPolicy = promptValue(
    await p.select({
      message: 'Which group mentions are allowed?',
      options: [
        {
          value: 'blocked',
          label: 'Block @here and @all',
          hint: 'recommended · avoids broad accidental notifications',
        },
        {
          value: 'here-only',
          label: 'Allow @here, block @all',
          hint: 'may notify active room members',
        },
        {
          value: 'all',
          label: 'Allow @here and @all',
          hint: 'high impact · intended for trusted operational alerts',
        },
      ],
      initialValue: currentMentionPolicy,
    }),
  ) as MentionPolicy;

  p.note(
    'File upload reads local files from the machine running this MCP.\n' +
      'Use an explicit path allowlist to prevent accidental access to secrets or personal files.',
    'Local file uploads',
  );
  const currentUploadPaths = splitCsv(current.ROCKETCHAT_ALLOWED_UPLOAD_PATHS);
  const currentUploadAccess: UploadAccess =
    currentUploadPaths.length === 1 && currentUploadPaths[0] === '/'
      ? 'all'
      : currentUploadPaths.length > 0
        ? 'selected'
        : 'disabled';
  const uploadAccess = promptValue(
    await p.select({
      message: 'Which local files may this MCP upload?',
      options: [
        {
          value: 'disabled',
          label: 'Disable file uploads',
          hint: 'recommended · no local files can be read for upload',
        },
        {
          value: 'selected',
          label: 'Selected files or directories',
          hint: 'allow one or more explicit local paths',
        },
        {
          value: 'all',
          label: 'All readable local files',
          hint: 'high risk · may expose credentials and personal files',
        },
      ],
      initialValue: currentUploadAccess,
    }),
  ) as UploadAccess;

  let allowedUploadPaths: string[] = [];
  if (uploadAccess === 'selected') {
    const paths = promptValue(
      await p.text({
        message: 'Allowed upload paths (comma-separated)',
        placeholder:
          process.platform === 'win32'
            ? String.raw`C:\projects,C:\temp\reports`
            : '/Users/me/projects,/private/tmp/reports',
        initialValue: currentUploadAccess === 'selected' ? currentUploadPaths.join(',') : '',
        validate(value) {
          const entries = splitCsv(value);
          if (entries.length === 0) return 'Enter at least one file or directory path.';
          if (entries.some(hasControlCharacters)) {
            return 'Upload paths must not contain control characters.';
          }
          if (entries.some((entry) => !isAbsolute(entry))) {
            return 'Use absolute file or directory paths.';
          }
          if (entries.includes('/')) {
            return 'Choose “All readable local files” instead of entering root (/).';
          }
        },
      }),
    );
    allowedUploadPaths = splitCsv(paths);
  }

  return {
    roomAccess,
    selectedRoomIds,
    dmAccess,
    selectedDmUsers,
    mentionPolicy,
    uploadAccess,
    allowedUploadPaths,
  };
}

async function collectCredentialStorage(): Promise<CredentialStorage> {
  p.note(
    'A dedicated profile keeps the token out of Codex/Claude configuration.\n' +
      'Plaintext client storage is simpler but also copies the token into configuration backups.',
    'Credential storage',
  );
  return promptValue(
    await p.select({
      message: 'Where should credentials be stored?',
      options: [
        {
          value: 'env-file',
          label: 'Dedicated environment profile',
          hint: 'recommended · client config stores only a file path',
        },
        {
          value: 'client-config',
          label: 'MCP client configuration',
          hint: 'token is stored as plaintext in every selected client config',
        },
      ],
      initialValue: 'env-file',
    }),
  ) as CredentialStorage;
}

function loadExistingProfiles(profilesDir: string): ExistingProfile[] {
  if (!existsSync(profilesDir)) return [];
  return readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.env'))
    .map((entry) => {
      const path = `${profilesDir}/${entry.name}`;
      return {
        name: basename(entry.name, '.env'),
        env: parseProfileEnvironment(readFileSync(path, 'utf8')),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function detectedAgentDefaults(agents: AgentPath[]): AgentId[] {
  const detected = agents.filter((agent) => existsSync(agent.configPath)).map((agent) => agent.id);
  return detected.length > 0 ? detected : ['codex'];
}

function describeRoomPolicy(
  access: RoomAccess,
  selected: string[],
  discovery: ConnectionDiscovery | undefined,
): string {
  if (access === 'all') return 'All joined rooms, including rooms joined later';
  const names = selected.map((id) => discovery?.rooms.find((room) => room.id === id)?.name ?? id);
  return `${String(selected.length)} selected · ${names.join(', ')}`;
}

function describeDmPolicy(access: DmAccess, selected: string[]): string {
  if (access === 'disabled') return 'Disabled';
  if (access === 'all') return 'Any resolved workspace user';
  return `${String(selected.length)} selected · ${selected.map((user) => `@${user}`).join(', ')}`;
}

function describeMentionPolicy(policy: MentionPolicy): string {
  if (policy === 'blocked') return '@here blocked · @all blocked';
  if (policy === 'here-only') return '@here allowed · @all blocked';
  return '@here allowed · @all allowed';
}

function describeUploadPolicy(access: UploadAccess, paths: string[]): string {
  if (access === 'disabled') return 'Disabled';
  if (access === 'all') return 'All readable local files (high risk)';
  return `${String(paths.length)} selected · ${paths.join(', ')}`;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function promptValue<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Setup cancelled. Nothing was changed.');
    process.exit(0);
  }
  return value as T;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, skipConnectionTest: false };
  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-connection-test') {
      options.skipConnectionTest = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      process.stdout.write(VERSION + '\n');
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}. Run with --help to see supported options.`);
    }
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`\
Create a stable Rocket.Chat MCP installation.

Usage:
  npm create rocketchat-mcp@latest
  npm create rocketchat-mcp@latest -- --dry-run

Options:
  --dry-run                Preview choices without installing or writing files
  --skip-connection-test   Configure manually without calling Rocket.Chat
  -h, --help               Show this help
  -v, --version            Show initializer version
`);
}

function readPackageMetadata(): { version: string; runtimeVersion: string } {
  try {
    const packageUrl = new URL('../package.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(packageUrl, 'utf8')) as {
      version?: unknown;
      rocketchatMcp?: { runtimeVersion?: unknown };
    };
    const version = typeof parsed.version === 'string' ? parsed.version : '0.0.0';
    const runtimeVersion =
      typeof parsed.rocketchatMcp?.runtimeVersion === 'string'
        ? parsed.rocketchatMcp.runtimeVersion
        : version;
    return { version, runtimeVersion };
  } catch {
    return { version: '0.0.0', runtimeVersion: '0.0.0' };
  }
}

void main().catch((error) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
