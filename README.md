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

1. 安装 CLI：

```bash
npm install -g dbx-cli
dbx --help
```

2. 如果你要给 Codex 用，把 skill 安装到 Codex 全局目录。

以默认全局目录 `~/.codex/skills` 为例：

```bash
mkdir -p ~/.codex/skills
cp -R "$(npm root -g)/dbx-cli/skills/dbx" ~/.codex/skills/dbx
```

如果你用的是自定义 `CODEX_HOME`，把目标目录换成 `$CODEX_HOME/skills/dbx` 即可。

3. 初始化配置文件：

```bash
dbx config
```

这一步通常只需要做一次。后面只要配置文件还在，就直接运行 `dbx profile list`、`dbx ping`、`dbx sql`、`dbx redis`。

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

## Docker 本地联调

仓库里现在提供了一套可重复使用的本地联调环境：

- `docker-compose.yml`
- `scripts/docker-smoke-test.sh`

如果你的环境带 `docker compose` 或 `docker-compose`，可以直接起服务：

```bash
docker compose up -d
```

运行一键冒烟：

```bash
npm run test:docker
```

这会自动完成：

- 启动 MySQL 和 Redis
- 生成临时 `profiles.yml`
- 覆盖 `config / profile list / profile show / ping / sql / redis`
- 验证 MySQL 和 Redis 的只读拦截

如果你想保留容器不自动清理：

```bash
KEEP_SERVICES=1 npm run test:docker
```

这套脚本优先使用 Docker Compose；如果当前机器没有 Compose，也会自动回退到 `docker run`。

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

如果你希望 Codex 能直接调用 `dbx`，除了安装 npm 包，还需要把这个 skill 放进 Codex 的 skills 目录。

以 Codex 默认全局目录 `~/.codex/skills` 为例：

```bash
mkdir -p ~/.codex/skills
cp -R "$(npm root -g)/dbx-cli/skills/dbx" ~/.codex/skills/dbx
```

如果你使用自定义 `CODEX_HOME`，对应目录就是：

```bash
$CODEX_HOME/skills/dbx
```

装好以后，可以在 Codex 里直接这样说：

- `使用 $dbx 列出当前可用的 profile`
- `使用 $dbx ping mysql_test`
- `使用 $dbx 查看 redis_test 里某个 key 的 TTL`
- `使用 $dbx 查 prod_mysql_ro 最近 10 条订单`

这个 skill 默认会引导 Codex：

- 已知 profile 和目标时直接执行 `dbx`
- 只有在 profile 不明确或连通性可疑时才补 `profile list`、`profile show`、`ping`
- 按场景选择 `dbx sql` 或 `dbx redis`
- 遇到 `READONLY_BLOCKED` 直接停止，不尝试绕过
