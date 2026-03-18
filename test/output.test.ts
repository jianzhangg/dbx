import test from "node:test";
import assert from "node:assert/strict";
import { DbxError, ExitCode } from "../src/errors.js";
import { errorResult, successResult } from "../src/output.js";

test("successResult includes command context", () => {
  const result = successResult(
    { ping: "pong" },
    {
      profile: "prod_mysql",
      kind: "mysql",
      readonly: true
    }
  );

  assert.deepEqual(result, {
    ok: true,
    profile: "prod_mysql",
    kind: "mysql",
    readonly: true,
    data: {
      ping: "pong"
    }
  });
});

test("errorResult includes code, message, and details when present", () => {
  const result = errorResult(
    new DbxError(
      "CONFIG_INVALID",
      "Config file schema is invalid",
      ExitCode.InvalidInput,
      { profiles: ["Required"] }
    ),
    {
      profile: "prod_mysql",
      kind: "mysql",
      readonly: true
    }
  );

  assert.deepEqual(result, {
    ok: false,
    profile: "prod_mysql",
    kind: "mysql",
    readonly: true,
    error: {
      code: "CONFIG_INVALID",
      message: "Config file schema is invalid",
      details: {
        profiles: ["Required"]
      }
    }
  });
});

test("errorResult omits details when none were provided", () => {
  const result = errorResult(
    new DbxError("READONLY_BLOCKED", "SET is not allowed when readonly=true", ExitCode.ReadonlyBlocked)
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "READONLY_BLOCKED",
      message: "SET is not allowed when readonly=true"
    }
  });
});
