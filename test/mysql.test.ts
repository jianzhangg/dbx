import test from "node:test";
import assert from "node:assert/strict";
import {
  countSqlStatements,
  isMysqlExecutionTimeoutError,
  validateReadonlySql
} from "../src/mysql.js";

test("countSqlStatements allows trailing semicolon", () => {
  assert.equal(countSqlStatements("select 1;"), 1);
});

test("countSqlStatements ignores semicolon in strings", () => {
  assert.equal(countSqlStatements("select ';' as value;"), 1);
});

test("countSqlStatements ignores semicolons in comments", () => {
  assert.equal(countSqlStatements("select 1 /* ; */; -- ;\n"), 1);
});

test("countSqlStatements detects multiple statements", () => {
  assert.equal(countSqlStatements("select 1; select 2;"), 2);
});

test("validateReadonlySql allows show and explain", () => {
  assert.equal(validateReadonlySql("show tables"), undefined);
  assert.equal(validateReadonlySql("explain select * from user"), undefined);
});

test("validateReadonlySql allows common readonly cte queries", () => {
  assert.equal(
    validateReadonlySql("with recent as (select * from user) select * from recent"),
    undefined
  );
});

test("validateReadonlySql blocks writes and ddl", () => {
  assert.notEqual(validateReadonlySql("update user set name = 'a'"), undefined);
  assert.notEqual(validateReadonlySql("with t as (select 1) delete from user"), undefined);
});

test("validateReadonlySql blocks transaction control statements", () => {
  assert.notEqual(validateReadonlySql("begin"), undefined);
  assert.notEqual(validateReadonlySql("set autocommit = 0"), undefined);
});

test("isMysqlExecutionTimeoutError matches mysql timeout errors", () => {
  assert.equal(isMysqlExecutionTimeoutError({ code: "ER_QUERY_TIMEOUT" }), true);
  assert.equal(isMysqlExecutionTimeoutError({ errno: 3024 }), true);
  assert.equal(
    isMysqlExecutionTimeoutError({
      message: "Query execution was interrupted, maximum statement execution time exceeded"
    }),
    true
  );
  assert.equal(isMysqlExecutionTimeoutError({ code: "ER_PARSE_ERROR" }), false);
  assert.equal(isMysqlExecutionTimeoutError(new Error("plain failure")), false);
});
