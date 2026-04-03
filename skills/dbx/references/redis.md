# Redis 场景

在用户要用 `dbx` 查询 Redis profile 时，读取这个文件。

## 常见请求

- “这个 profile 能不能连”：`dbx ping <profile>`
- “这个 key 在不在”：`dbx redis <profile> EXISTS <key>`
- “取一个值”：`dbx redis <profile> GET <key>`
- “批量取值”：`dbx redis <profile> MGET <key1> <key2>`
- “看剩余 TTL”：`dbx redis <profile> TTL <key>`
- “看 key 类型”：`dbx redis <profile> TYPE <key>`
- “查 hash 字段”：`dbx redis <profile> HGET <key> <field>`
- “看整个 hash”：`dbx redis <profile> HGETALL <key>`
- “看列表前几项”：`dbx redis <profile> LRANGE <key> 0 9`
- “看集合成员”：`dbx redis <profile> SMEMBERS <key>`
- “按模式找 key”：`dbx redis <profile> SCAN 0 MATCH <pattern> COUNT 100`

## 默认写法

- Redis 命令和参数顺序按用户原意透传。
- 默认只做单条只读命令，不拼脚本。
- 模糊查找 key 时优先 `SCAN`，不要默认 `KEYS`。
- 值很长时，先总结类型、条数或关键字段，再补原始结果。

## 只读约束

- 只读 profile 下，不要执行 `SET`、`DEL`、`EXPIRE`、`INCR`、`LPUSH`、`SADD`、`ZADD`、`FLUSHDB` 这类写命令。
- 如果命令会修改数据或 TTL，直接停下，不要自行改成可写 profile。

## 输出方式

- 先说 key 是否存在、值是否命中，再展示核心结果。
- 多元素结果优先总结数量和前几项，不把长列表整段倒给用户。
