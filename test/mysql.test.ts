import test from "node:test";
import assert from "node:assert/strict";
import { countSqlStatements, validateReadonlySql } from "../src/mysql.js";

test("countSqlStatements allows trailing semicolon", () => {
  assert.equal(countSqlStatements("select 1;"), 1);
});

test("countSqlStatements ignores semicolon in strings", () => {
  assert.equal(countSqlStatements("select ';' as value;"), 1);
});

test("countSqlStatements detects multiple statements", () => {
  assert.equal(countSqlStatements("select 1; select 2;"), 2);
});

test("validateReadonlySql allows show and explain", () => {
  assert.equal(validateReadonlySql("show tables"), undefined);
  assert.equal(validateReadonlySql("explain select * from user"), undefined);
});

test("validateReadonlySql blocks writes and ddl", () => {
  assert.notEqual(validateReadonlySql("update user set name = 'a'"), undefined);
  assert.notEqual(validateReadonlySql("with t as (select 1) delete from user"), undefined);
});
