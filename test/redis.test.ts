import test from "node:test";
import assert from "node:assert/strict";
import { READONLY_REDIS_COMMANDS } from "../src/redis.js";

test("readonly redis commands include common reads", () => {
  assert.equal(READONLY_REDIS_COMMANDS.has("GET"), true);
  assert.equal(READONLY_REDIS_COMMANDS.has("HGETALL"), true);
  assert.equal(READONLY_REDIS_COMMANDS.has("SCAN"), true);
});

test("readonly redis commands include diagnostic reads", () => {
  assert.equal(READONLY_REDIS_COMMANDS.has("PING"), true);
  assert.equal(READONLY_REDIS_COMMANDS.has("INFO"), true);
  assert.equal(READONLY_REDIS_COMMANDS.has("DBSIZE"), true);
});

test("readonly redis commands exclude writes", () => {
  assert.equal(READONLY_REDIS_COMMANDS.has("SET"), false);
  assert.equal(READONLY_REDIS_COMMANDS.has("DEL"), false);
  assert.equal(READONLY_REDIS_COMMANDS.has("EVAL"), false);
});

test("readonly redis commands are stored in uppercase", () => {
  assert.equal(READONLY_REDIS_COMMANDS.has("get"), false);
  assert.equal(READONLY_REDIS_COMMANDS.has("GET"), true);
});
