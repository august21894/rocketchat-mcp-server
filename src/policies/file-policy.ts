/** Local-file policy for Rocket.Chat uploads. */
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { AppError } from '../errors.js';
import type { AppConfig } from '../config/schema.js';

export interface AllowedUploadFile {
  absolutePath: string;
  name: string;
  size: number;
  contentType: string;
}

export class FilePolicy {
  private readonly allowedPaths: string[];
  private readonly maxUploadBytes: number;

  constructor(config: Pick<AppConfig, 'allowedUploadPaths' | 'maxUploadBytes'>) {
    this.allowedPaths = config.allowedUploadPaths.map((path) =>
      isAbsolute(path) ? path : resolve(process.cwd(), path),
    );
    this.maxUploadBytes = config.maxUploadBytes;
  }

  async inspect(inputPath: string): Promise<AllowedUploadFile> {
    if (this.allowedPaths.length === 0) {
      throw new AppError(
        'permission_denied',
        'Local file uploads are disabled. Configure ROCKETCHAT_ALLOWED_UPLOAD_PATHS first.',
      );
    }

    let actualPath: string;
    try {
      actualPath = await realpath(
        isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath),
      );
    } catch (cause) {
      throw new AppError('invalid_input', 'The upload file does not exist or cannot be read.', {
        cause,
      });
    }

    if (!(await this.isAllowed(actualPath))) {
      throw new AppError(
        'permission_denied',
        'The upload file is outside the configured path allowlist.',
      );
    }

    let metadata;
    try {
      metadata = await stat(actualPath);
    } catch (cause) {
      throw new AppError('invalid_input', 'The upload file cannot be inspected.', { cause });
    }
    if (!metadata.isFile()) {
      throw new AppError('invalid_input', 'The upload path must refer to a regular file.');
    }
    if (metadata.size > this.maxUploadBytes) {
      throw new AppError('invalid_input', 'The upload file exceeds the configured size limit.', {
        details: { size: metadata.size, max: this.maxUploadBytes },
      });
    }

    const name = basename(actualPath);
    if (
      Array.from(name).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
      })
    ) {
      throw new AppError('invalid_input', 'The upload file name contains unsafe characters.');
    }

    return {
      absolutePath: actualPath,
      name,
      size: metadata.size,
      contentType: contentTypeFor(actualPath),
    };
  }

  async read(file: AllowedUploadFile): Promise<Uint8Array> {
    let currentPath: string;
    try {
      currentPath = await realpath(file.absolutePath);
    } catch (cause) {
      throw new AppError('invalid_input', 'The upload file could not be read.', { cause });
    }
    if (currentPath !== file.absolutePath || !(await this.isAllowed(currentPath))) {
      throw new AppError(
        'permission_denied',
        'The upload file changed and is now outside the configured path allowlist.',
      );
    }

    let handle;
    try {
      // O_NOFOLLOW closes the remaining symlink race between the second
      // realpath check and opening the file on POSIX platforms.
      handle = await open(currentPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile()) {
        throw new AppError('invalid_input', 'The upload path must refer to a regular file.');
      }
      if (metadata.size !== file.size) {
        throw new AppError('invalid_input', 'The upload file changed after it was validated.');
      }
      const contents = await handle.readFile();
      if (contents.byteLength > this.maxUploadBytes) {
        throw new AppError('invalid_input', 'The upload file exceeds the configured size limit.', {
          details: { size: contents.byteLength, max: this.maxUploadBytes },
        });
      }
      return contents;
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError('invalid_input', 'The upload file could not be read safely.', { cause });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async isAllowed(filePath: string): Promise<boolean> {
    for (const configuredPath of this.allowedPaths) {
      let allowedPath: string;
      try {
        allowedPath = await realpath(configuredPath);
      } catch {
        continue;
      }
      const allowedStat = await stat(allowedPath).catch(() => undefined);
      if (!allowedStat) continue;
      if (allowedStat.isFile() && filePath === allowedPath) return true;
      if (allowedStat.isDirectory()) {
        const child = relative(allowedPath, filePath);
        if (child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)) {
          return true;
        }
      }
    }
    return false;
  }
}

function contentTypeFor(path: string): string {
  const types: Record<string, string> = {
    '.csv': 'text/csv',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
  };
  return types[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
