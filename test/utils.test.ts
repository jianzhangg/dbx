import test from "node:test";
import assert from "node:assert/strict";
import { DbxError } from "../src/errors.js";
import { expandPath, withTimeout } from "../src/utils.js";

test("withTimeout returns the operation result before the deadline", async () => {
  const result = await withTimeout(async () => "ok", 100);
  assert.equal(result, "ok");
});

test("withTimeout rejects with a timeout error and runs cleanup", async () => {
  let cleanedUp = false;

  await assert.rejects(
    withTimeout(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "late";
      },
      5,
      () => {
        cleanedUp = true;
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof DbxError);
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.message, "Operation timed out after 1s");
      return true;
    }
  );

  assert.equal(cleanedUp, true);
});

test("expandPath resolves home and relative paths", () => {
  const homeDir = process.env.HOME;
  const userProfile = process.env.USERPROFILE;

  process.env.HOME = "/tmp/dbx-home";
  process.env.USERPROFILE = "/tmp/dbx-home";

  try {
    assert.equal(expandPath("~/profiles.yml"), "/tmp/dbx-home/profiles.yml");
    assert.equal(expandPath("profiles.yml", "/work/dbx"), "/work/dbx/profiles.yml");
    assert.equal(expandPath("~\\profiles.yml"), "/tmp/dbx-home/profiles.yml");
  } finally {
    if (homeDir === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = homeDir;
    }

    if (userProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = userProfile;
    }
  }
});
