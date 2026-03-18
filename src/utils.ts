import os from "node:os";
import path from "node:path";
import { DbxError, ExitCode } from "./errors.js";

export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void | Promise<void>
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation();
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void Promise.resolve(onTimeout?.()).finally(() => {
        reject(
          new DbxError(
            "TIMEOUT",
            `Operation timed out after ${Math.ceil(timeoutMs / 1000)}s`,
            ExitCode.Timeout
          )
        );
      });
    }, timeoutMs);

    void operation()
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function expandPath(filePath: string, cwd = process.cwd()): string {
  if (filePath === "~") {
    return os.homedir() || cwd;
  }
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir() || cwd, filePath.slice(2));
  }
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(cwd, filePath);
}
