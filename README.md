# dbx

`dbx` 是一个面向 MySQL 和 Redis 的本地 CLI。

它用一份 YAML profile 管理连接信息，把数据库访问收口成几条稳定命令：

- `dbx profile list`
- `dbx ping <profile>`
- `dbx sql <profile> "<sql>"`
- `dbx redis <profile> <command> [args...]`

默认输出 JSON，并内置两类保护：

- `readonly`: 只读 profile 下阻止写操作
- `timeout`: MySQL 查询会下沉到 session `max_execution_time`，CLI 侧仍会超时返回

## 5 分钟上手

1. 安装 CLI：

```bash
npm install -g dbx-cli
dbx --help
```

2. 初始化配置文件：

```bash
dbx config
```

默认配置路径：

```text
macOS / Linux: ~/.config/dbx/profiles.yml
Windows: %APPDATA%\dbx\profiles.yml
```

如果你想用别的路径：

```bash
DBX_CONFIG=/absolute/path/to/profiles.yml dbx profile list
dbx --config /absolute/path/to/profiles.yml profile list
```

3. 按下面的格式写 profile：

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

4. 验证连接并开始查询：

```bash
dbx profile list
dbx ping prod_mysql_ro
dbx sql prod_mysql_ro "select now() as now_time"
dbx redis cache_redis_ro GET session:1
```

## 给 Codex 用

如果你希望 Codex 能直接调用 `dbx`，把仓库自带的 skill 安装到 Codex 的全局 skills 目录即可。

以默认目录 `~/.codex/skills` 为例：

```bash
PACKAGE_NAME="dbx-cli"
mkdir -p ~/.codex/skills
cp -R "$(npm root -g)/${PACKAGE_NAME}/skills/dbx" ~/.codex/skills/dbx
```

如果你使用自定义 `CODEX_HOME`，目标目录就是 `$CODEX_HOME/skills/dbx`。

装好以后，可以直接这样说：

- `使用 $dbx 列出当前可用的 profile`
- `使用 $dbx ping mysql_test`
- `使用 $dbx 查看 redis_test 里某个 key 的 TTL`
- `使用 $dbx 查 prod_mysql_ro 最近 10 条订单`

## 配置说明

建议把只读和可写 profile 分开，不要混用。

字段说明：

- `kind`: `mysql` 或 `redis`
- `readonly`: `true` 表示启用只读保护，`false` 表示允许写
- `timeout`: 秒级超时，默认 `30`

MySQL 补充说明：

- `dbx` 会把 `timeout` 转成毫秒并设置到当前连接的 session `max_execution_time`
- 这个限制由 MySQL 服务端执行，主要作用于 `SELECT` / `WITH` 这类只读查询
- CLI 侧仍保留本地超时兜底

如果你只想从安全用法开始，先只配置 `*_ro` 即可。

## 命令参考

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

## 输出与错误码

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
- 每次只允许一条 SQL
- 执行时会包在 `START TRANSACTION READ ONLY` 中

Redis：

- `readonly: true` 时只允许内置只读命令集合
- `GET`、`MGET`、`HGETALL`、`SMEMBERS`、`ZRANGE`、`LRANGE`、`TTL`、`PING` 等可用
- `SET`、`DEL`、`HSET`、`LPUSH` 这类写命令会直接被拦截

建议：

- 日常排查默认使用 `*_ro`
- 真要写入时显式切到 `*_rw`
- 不要把读写权限混在同一个 profile 里
