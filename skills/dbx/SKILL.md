---
name: dbx
description: 使用本地 dbx CLI 按 profile 访问 MySQL 和 Redis，并遵守内置的只读与超时约束。
---

# DBX CLI

当用户希望通过本地 `dbx` CLI 访问 MySQL 或 Redis，而不是走 MCP 时，使用这个 skill。

## 工作流

1. 先运行 `dbx profile list`，确认当前有哪些 profile。
2. 如果需要确认 `kind`、`readonly` 或 `timeout`，运行 `dbx profile show <profile>`。
3. 如果用户不确定 profile 是否可连，先运行 `dbx ping <profile>` 再查询。
4. 优先使用这些命令形态：
   - `dbx sql <profile> "<sql>"`
   - `dbx redis <profile> <command> [args...]`
   - `dbx ping <profile>`
5. 直接读取 stdout 中的 JSON 结果，不要自己重组一套输出格式。

## 规则

- 只要本地可用，就优先用 `dbx`，不要改建议用户走 MySQL 或 Redis MCP。
- 如果配置文件不存在，或者用户想知道配置文件在哪里，运行 `dbx config`。
- 如果返回 `PROFILE_NOT_FOUND` 或 `PROFILE_KIND_MISMATCH`，直接说明 profile 不存在或类型不匹配，不要猜另一个 profile。
- 如果返回 `READONLY_BLOCKED`，立即停止，不要尝试改成写命令或换可写 profile。
- `timeout` 的单位是秒。
- MySQL 每次调用只能发送一条 SQL。
- Redis 每次调用只发送一条命令和它的参数，按用户原意透传。
