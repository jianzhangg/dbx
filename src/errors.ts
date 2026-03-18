export enum ExitCode {
  Success = 0,
  InvalidInput = 2,
  ReadonlyBlocked = 3,
  Timeout = 4,
  ExecutionFailed = 5,
  ProfileNotFound = 6
}

export class DbxError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly details?: unknown;

  constructor(code: string, message: string, exitCode: ExitCode, details?: unknown) {
    super(message);
    this.name = "DbxError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function toDbxError(error: unknown): DbxError {
  if (error instanceof DbxError) {
    return error;
  }
  if (error instanceof Error) {
    return new DbxError("EXECUTION_FAILED", error.message, ExitCode.ExecutionFailed);
  }
  return new DbxError("EXECUTION_FAILED", String(error), ExitCode.ExecutionFailed);
}
