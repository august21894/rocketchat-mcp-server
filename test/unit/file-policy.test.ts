import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePolicy } from '../../src/policies/file-policy.js';
import { makeConfig } from '../fixtures/config.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

describe('FilePolicy', () => {
  it('allows a regular file under an allow-listed directory', async () => {
    const root = await tempDirectory('rc-upload-allowed-');
    const nested = join(root, 'nested');
    await mkdir(nested);
    const filePath = join(nested, 'report.txt');
    await writeFile(filePath, 'hello');
    const policy = new FilePolicy(
      makeConfig({ ROCKETCHAT_ALLOWED_UPLOAD_PATHS: root, ROCKETCHAT_MAX_UPLOAD_BYTES: '10' }),
    );

    await expect(policy.inspect(filePath)).resolves.toMatchObject({
      name: 'report.txt',
      size: 5,
      contentType: 'text/plain',
    });
  });

  it('disables uploads when the path allowlist is empty', async () => {
    const root = await tempDirectory('rc-upload-disabled-');
    const filePath = join(root, 'report.txt');
    await writeFile(filePath, 'hello');
    const policy = new FilePolicy(makeConfig({ ROCKETCHAT_ALLOWED_UPLOAD_PATHS: '' }));
    await expect(policy.inspect(filePath)).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('rejects a file outside the allowlist and a symlink escaping it', async () => {
    const allowed = await tempDirectory('rc-upload-allowed-');
    const outside = await tempDirectory('rc-upload-outside-');
    const secret = join(outside, 'secret.txt');
    await writeFile(secret, 'secret');
    const link = join(allowed, 'link.txt');
    await symlink(secret, link);
    const policy = new FilePolicy(makeConfig({ ROCKETCHAT_ALLOWED_UPLOAD_PATHS: allowed }));

    await expect(policy.inspect(secret)).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(policy.inspect(link)).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('rejects files larger than the configured maximum', async () => {
    const root = await tempDirectory('rc-upload-size-');
    const filePath = join(root, 'large.bin');
    await writeFile(filePath, Buffer.alloc(11));
    const policy = new FilePolicy(
      makeConfig({ ROCKETCHAT_ALLOWED_UPLOAD_PATHS: root, ROCKETCHAT_MAX_UPLOAD_BYTES: '10' }),
    );
    await expect(policy.inspect(filePath)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects a file swapped for an escaping symlink after inspection', async () => {
    const allowed = await tempDirectory('rc-upload-race-allowed-');
    const outside = await tempDirectory('rc-upload-race-outside-');
    const filePath = join(allowed, 'artifact.txt');
    const secret = join(outside, 'secret.txt');
    await writeFile(filePath, 'safe');
    await writeFile(secret, 'secret');
    const policy = new FilePolicy(makeConfig({ ROCKETCHAT_ALLOWED_UPLOAD_PATHS: allowed }));
    const inspected = await policy.inspect(filePath);
    await unlink(filePath);
    await symlink(secret, filePath);

    await expect(policy.read(inspected)).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('rejects control characters in the outbound file name', async () => {
    const root = await tempDirectory('rc-upload-name-');
    const filePath = join(root, 'unsafe\nname.txt');
    await writeFile(filePath, 'content');
    const policy = new FilePolicy(makeConfig({ ROCKETCHAT_ALLOWED_UPLOAD_PATHS: root }));
    await expect(policy.inspect(filePath)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
