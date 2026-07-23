# create-rocketchat-mcp

Interactive initializer for
[`rocketchat-mcp-server`](https://www.npmjs.com/package/rocketchat-mcp-server).

```bash
npm create rocketchat-mcp@latest
```

The initializer installs the runtime at a stable location, stores credentials in
a user-only profile by default, tests the Rocket.Chat connection, and configures
Codex, Claude Code, and/or Claude Desktop.

The initializer package declares the exact compatible runtime in
`package.json#rocketchatMcp.runtimeVersion`; release automation should update this
field whenever the runtime version changes.
