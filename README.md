# dbx

`dbx` 是一个 Node 18 CLI，用一份 YAML profile 同时管理 MySQL 和 Redis 访问。它的目标是替代散落的 MCP，改成 Codex 直接调用本地 CLI。

当前版本特性：
- MySQL 和 Redis 共用一套 profile 配置
- `readonly: true | false`
- `timeout` 秒级超时控制，默认 `30`
- 所有结果默认输出 JSON
- 仓库内附带 Codex skill，可直接教 Codex 使用 `dbx`

## 安装

从源码运行：

```bash
npm install
npm run build
node dist/index.js --help
```

如果后续发布到 npm：

```bash
npm install -g dbx-cli
dbx --help
```

## 配置

默认配置路径：

```bash
macOS / Linux: ~/.config/dbx/profiles.yml
Windows: %APPDATA%\dbx\profiles.yml
```

首次运行 `dbx config` 时，如果这个文件不存在，`dbx` 会自动创建目录并把模板写进去。

也支持覆盖：
- `DBX_CONFIG=/absolute/path/to/profiles.yml`
- `dbx --config /absolute/path/to/profiles.yml ...`

示例配置见 [`profiles.example.yml`](./profiles.example.yml)。

```yaml
profiles:
  prod_mysql:
    kind: mysql
    host: 127.0.0.1
    port: 3306
    user: readonly
    password: secret
    database: app
    readonly: true
    timeout: 30

  cache_redis:
    kind: redis
    url: redis://default:secret@127.0.0.1:6379/0
    readonly: true
    timeout: 30
```

字段说明：
- `kind`: `mysql` 或 `redis`
- `readonly`: 是否启用只读保护
- `timeout`: 超时秒数，默认 `30`

## 命令

```bash
dbx config
dbx profile list
dbx profile show prod_mysql
dbx ping prod_mysql
dbx sql prod_mysql "select now()"
dbx redis cache_redis GET session:1
```

`dbx config` 会返回：
- `configPath`: 当前使用的配置文件路径
- `created`: 本次是否刚创建了配置文件
- `templatePath`: 当前包内模板路径
- `howToConfigure`: 修改配置文件的简短说明

常见返回：

```json
{
  "ok": true,
  "profile": "prod_mysql",
  "kind": "mysql",
  "readonly": true,
  "data": {}
}
```

错误返回：

```json
{
  "ok": false,
  "profile": "prod_mysql",
  "kind": "mysql",
  "readonly": true,
  "error": {
    "code": "READONLY_BLOCKED",
    "message": "Only SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH statements are allowed when readonly=true"
  }
}
```

失败返回固定包含：
- `error.code`: 稳定的错误类别
- `error.message`: 可直接展示或记录的具体失败信息
- `error.details`: 可选的结构化补充信息，当前主要用于配置/schema 校验错误

退出码：
- `0` 成功
- `2` 参数或配置错误
- `3` 被 `readonly` 拦截
- `4` 超时
- `5` 执行失败
- `6` profile 不存在

## Readonly 规则

MySQL:
- `readonly: true` 时只允许以 `SELECT`、`SHOW`、`DESC`、`DESCRIBE`、`EXPLAIN`、`WITH` 开头的单条 SQL
- 同时包在 `START TRANSACTION READ ONLY` 中执行
- `readonly: false` 时允许任意单条 SQL

Redis:
- `readonly: true` 时只允许内置只读命令集合
- `readonly: false` 时允许任意单条 Redis 命令

`readonly` 的目标是阻止修改持久数据，不负责限制慢查询；慢查询由 `timeout` 控制。

## 测试

```bash
npm test
```

仓库内也已经用本地 Docker + Colima 实际验证过：
- MySQL 只读查询成功
- MySQL 写操作在 `readonly: true` 下被拦截
- Redis 只读命令成功
- Redis 写命令在 `readonly: true` 下被拦截
- `readonly: false` 下允许真实写入

## Codex Skill

仓库内包含 skill：

```text
skills/dbx
```

用途：
- 先让 Codex 跑 `dbx profile list`
- 再按 profile 类型选择 `dbx sql ...` 或 `dbx redis ...`
- 默认消费 JSON 输出
- 遇到 `READONLY_BLOCKED` 直接停止，不绕过保护
