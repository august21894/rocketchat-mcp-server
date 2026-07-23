// Minimal, NON-interactive post-install hint. It NEVER prompts (prompting during
// npm install breaks CI, non-TTY installs, and dependency installs). It only
// prints a short pointer to the explicit setup command, and only in an
// interactive terminal outside CI.
const isCI = process.env.CI === 'true' || process.env.CI === '1' || !!process.env.GITHUB_ACTIONS;
const interactive = process.stdout.isTTY && process.stdin.isTTY;

if (interactive && !isCI) {
  const lines = [
    '',
    '  Rocket.Chat MCP server installed.',
    '  Recommended guided setup:',
    '',
    '    npm create rocketchat-mcp@latest',
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}
