# MySQL 场景

在用户要用 `dbx` 查询 MySQL profile 时，读取这个文件。

## 常见请求

- “这个 profile 能不能连”：`dbx ping <profile>`
- “查最近 10 条”：`dbx sql <profile> "select ... order by <column> desc limit 10"`
- “按 id 查一条”：`dbx sql <profile> "select ... from <table> where id = ... limit 1"`
- “统计数量”：`dbx sql <profile> "select count(*) as count from <table> where ..."`
- “看表结构”：`dbx sql <profile> "show columns from <table>"`
- “看建表语句”：`dbx sql <profile> "show create table <table>"`
- “看执行计划”：`dbx sql <profile> "explain <select ...>"`

## 默认写法

- 除聚合查询外，默认加 `limit`。
- 结果列很多时，优先显式写字段名，不默认 `select *`。
- 用户没有给排序列时，不要猜字段；表结构不清楚就先查结构。
- 用户给的是自然语言目标时，把它翻译成一条 SQL，再直接执行。

## 只读约束

- 只读 profile 下，不要执行 `insert`、`update`、`delete`、`replace`、`create`、`drop`、`alter`、`truncate`。
- 不要把多条 SQL 用分号拼在一起。

## 输出方式

- 先说结论，再给关键行或聚合值。
- 返回很多行时，只展示最关键的几行，并说明查询已经带了 `limit`。
