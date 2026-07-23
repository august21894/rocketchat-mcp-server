import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface RuntimeInstallRequest {
  runtimeDir: string;
  runtimeVersion: string;
  dryRun: boolean;
}

export interface RuntimeInstallResult {
  serverPath: string;
  packageSpec: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function installRuntime(
  request: RuntimeInstallRequest,
): Promise<RuntimeInstallResult> {
  const packageSpec = `rocketchat-mcp-server@${request.runtimeVersion}`;
  const serverPath = join(
    request.runtimeDir,
    'node_modules',
    'rocketchat-mcp-server',
    'dist',
    'index.js',
  );
  if (!request.dryRun) {
    ensureManagedPackage(request.runtimeDir);
    await runNpm([
      'install',
      '--prefix',
      request.runtimeDir,
      '--save-exact',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      packageSpec,
    ]);
  }

  if (!request.dryRun && !existsSync(serverPath)) {
    throw new Error(`npm completed but the MCP runtime was not found at ${serverPath}`);
  }
  return { serverPath, packageSpec };
}

function ensureManagedPackage(runtimeDir: string): void {
  mkdirSync(runtimeDir, { recursive: true });
  const packagePath = join(runtimeDir, 'package.json');
  if (existsSync(packagePath)) {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Managed runtime package.json is invalid: ${packagePath}`);
    }
    return;
  }
  writeFileSync(
    packagePath,
    JSON.stringify(
      {
        name: 'rocketchat-mcp-managed-runtime',
        private: true,
        description: 'Managed by create-rocketchat-mcp',
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

async function runNpm(args: string[], cwd?: string): Promise<CommandResult> {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : 'npm';
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit code ${String(code)}`;
      reject(new Error(`npm command failed: ${detail}`));
    });
  });
}
