---
name: dbx
description: Use the local dbx CLI to inspect or query MySQL and Redis through profile-based access with built-in readonly and timeout behavior.
---

# DBX CLI

Use this skill when the user wants MySQL or Redis access through the local `dbx` CLI instead of MCP.

## Workflow

1. Run `dbx profile list` to discover available profiles.
2. Use `dbx profile show <profile>` if you need to confirm kind, timeout, or readonly mode.
3. Prefer these commands:
   - `dbx sql <profile> "<sql>"`
   - `dbx redis <profile> <command> [args...]`
   - `dbx ping <profile>`
4. Read JSON from stdout and use that result directly.

## Rules

- Do not suggest MCP for MySQL or Redis when `dbx` is available.
- If a command returns `READONLY_BLOCKED`, stop instead of trying a write alternative.
- Treat `timeout` as seconds.
- For MySQL, send exactly one SQL statement per invocation.
- For Redis, pass one command and its arguments exactly as the user requested.
