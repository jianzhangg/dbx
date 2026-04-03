---
name: dbx
description: 用本地 dbx CLI 按 profile 直接完成 MySQL/Redis 的探活、只读查询和结果核对。
---

# DBX CLI

当用户想通过本地 `dbx` CLI 操作 MySQL 或 Redis，或者需要基于现有 profile 做探活、只读查询、键检查或配置定位时，使用这个 skill。优先使用已经安装好的 `dbx`，不要改走 MCP。

## 快速分流

- 不知道有哪些 profile：`dbx profile list`
- 已知 `profile`，想确认 `kind`、`readonly` 或 `timeout`：`dbx profile show <profile>`
- 不确定目标是否可连：`dbx ping <profile>`
- 已知是 MySQL 查询：`dbx sql <profile> "<sql>"`
- 已知是 Redis 命令：`dbx redis <profile> <command> [args...]`
- 配置文件不存在，或者用户想知道默认路径：`dbx config`

## 默认执行方式

- 已知 `profile` 和明确目标时，直接执行，不先跑 `dbx profile list`。
- 只有在 `profile` 不明确、类型未知或连接可疑时，才补 `profile list`、`profile show` 或 `ping`。
- 用户说“查最近 N 条”“看表结构”“查某个 key”“看 TTL”这类请求时，直接翻译成一条 `dbx` 命令，不把问题改写成让用户自己执行。
- 输出先给结论，再给关键结果；原始 JSON 只在需要时附上。

## 按场景加载引用

- MySQL 查询、表结构、计数、最近 N 条：见 [references/mysql.md](references/mysql.md)
- Redis 取值、TTL、哈希、列表、集合、模糊查找：见 [references/redis.md](references/redis.md)

## 硬约束

- 只要本地 `dbx` 可用，就优先用它，不改建议用户走 MySQL 或 Redis MCP。
- 如果配置文件不存在，或者用户想知道配置文件在哪里，运行 `dbx config`。
- `dbx sql` 每次只能发送一条 SQL，不要拼多语句。
- `dbx redis` 每次只发送一条命令和它的参数，按用户原意透传。
- 如果返回 `PROFILE_NOT_FOUND` 或 `PROFILE_KIND_MISMATCH`，直接说明 profile 不存在或类型不匹配，不要猜另一个 profile。
- 如果返回 `READONLY_BLOCKED`，立即停止，不要改成写命令，也不要切到可写 profile。
- 连接失败时先保留原始报错；只有在用户要继续排查时，才补 `dbx ping`、配置路径或白名单检查。
- 不要臆测库名、表名、列名、key 名或数据结构；不确定时先查结构或元信息。
- `timeout` 的单位是秒。
