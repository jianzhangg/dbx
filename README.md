# dbx

`dbx` 是一个面向 MySQL 和 Redis 的本地 CLI。

它用一份 YAML profile 管理连接信息，把数据库访问收口成几条稳定命令：

- `dbx profile list`
- `dbx ping <profile>`
- `dbx sql <profile> "<sql>"`
- `dbx redis <profile> <command> [args...]`

这个工具适合给人直接用，也适合给 Codex 调用。它默认输出 JSON，并内置两类保护：

- `readonly`: 限制只读 profile 不能写库
- `timeout`: 超时自动断开，避免命令挂住

## 5 分钟上手

安装：

```bash
npm install -g dbx-cli
dbx --help
```

初始化配置文件：

```bash
dbx config
```

默认配置路径：

```bash
macOS / Linux: ~/.config/dbx/profiles.yml
Windows: %APPDATA%\dbx\profiles.yml
```

如果你想用别的路径：

```bash
DBX_CONFIG=/absolute/path/to/profiles.yml dbx profile list
dbx --config /absolute/path/to/profiles.yml profile list
```

先看有哪些 profile：

```bash
dbx profile list
dbx profile show prod_mysql_ro
```

连通性检查：

```bash
dbx ping prod_mysql_ro
dbx ping cache_redis_ro
```

开始查询：

```bash
dbx sql prod_mysql_ro "select now() as now_time"
dbx redis cache_redis_ro GET session:1
```

## 配置文件怎么写

推荐把只读和可写 profile 分开，不要混用：

```yaml
profiles:
  prod_mysql_ro:
    kind: mysql
    host: 127.0.0.1
    port: 3306
    user: readonly
    password: secret
    database: app
    readonly: true
    timeout: 30

  prod_mysql_rw:
    kind: mysql
    host: 127.0.0.1
    port: 3306
    user: app_user
    password: secret
    database: app
    readonly: false
    timeout: 30

  cache_redis_ro:
    kind: redis
    url: redis://default:secret@127.0.0.1:6379/0
    readonly: true
    timeout: 30

  cache_redis_rw:
    kind: redis
    url: redis://default:secret@127.0.0.1:6379/0
    readonly: false
    timeout: 30
```

字段说明：

- `kind`: `mysql` 或 `redis`
- `readonly`: `true` 表示启用只读保护，`false` 表示允许写
- `timeout`: 秒级超时，默认 `30`

如果只想从只读 profile 开始，先只配 `*_ro` 即可。

## 命令怎么用

### `dbx config`

显示当前使用的配置文件路径；如果文件不存在，会自动创建模板。

```bash
dbx config
```

### `dbx profile list`

列出所有 profile，只展示安全字段。

```bash
dbx profile list
```

### `dbx profile show <profile>`

查看某个 profile 的完整配置，敏感信息会被脱敏。

```bash
dbx profile show prod_mysql_ro
dbx profile show cache_redis_ro
```

### `dbx ping <profile>`

先用这个命令确认 profile 能连通。

```bash
dbx ping prod_mysql_ro
dbx ping cache_redis_ro
```

### `dbx sql <profile> "<sql>"`

执行一条 MySQL SQL。每次只能发一条语句。

```bash
dbx sql prod_mysql_ro "select id, name from users limit 10"
dbx sql prod_mysql_rw "insert into audit_log(action) values ('manual-check')"
```

### `dbx redis <profile> <command> [args...]`

执行一条 Redis 命令。

```bash
dbx redis cache_redis_ro GET session:1
dbx redis cache_redis_ro MGET session:1 session:2
dbx redis cache_redis_rw SET feature:flag on
```

## 输出长什么样

所有结果默认输出 JSON。

成功示例：

```json
{
  "ok": true,
  "profile": "prod_mysql_ro",
  "kind": "mysql",
  "readonly": true,
  "data": {
    "rows": [
      {
        "id": 1,
        "name": "alice"
      }
    ]
  }
}
```

失败示例：

```json
{
  "ok": false,
  "profile": "cache_redis_ro",
  "kind": "redis",
  "readonly": true,
  "error": {
    "code": "READONLY_BLOCKED",
    "message": "SET is not allowed when readonly=true"
  }
}
```

失败返回固定包含：

- `error.code`: 稳定错误码
- `error.message`: 可直接展示的错误信息
- `error.details`: 结构化补充信息，当前主要用于配置校验失败

退出码：

- `0`: 成功
- `2`: 参数或配置错误
- `3`: 被 `readonly` 拦截
- `4`: 超时
- `5`: 执行失败
- `6`: profile 不存在

## 只读规则

MySQL：

- `readonly: true` 时只允许 `SELECT`、`SHOW`、`DESC`、`DESCRIBE`、`EXPLAIN`、`WITH`
- 只允许一条 SQL
- 执行时会包在 `START TRANSACTION READ ONLY` 中

Redis：

- `readonly: true` 时只允许内置只读命令集合
- `GET`、`MGET`、`HGETALL`、`SMEMBERS`、`ZRANGE`、`LRANGE`、`TTL`、`PING` 等可用
- `SET`、`DEL`、`HSET`、`LPUSH` 这类写命令会直接被拦截

建议：

- 日常排查默认使用 `*_ro`
- 真要写入时显式切到 `*_rw`
- 不要把“读写混合”的权限放在同一个 profile 里

## 给 Codex 用

仓库里自带 skill：

```text
skills/dbx
```

这个 skill 会引导 Codex：

- 先跑 `dbx profile list`
- 按 profile 类型决定走 `dbx sql` 还是 `dbx redis`
- 默认消费 JSON 输出
- 遇到 `READONLY_BLOCKED` 直接停止，不尝试绕过
