/**
 * An error `/storage` reports to the app, as `{ error, code }` with a non-2xx
 * status (doc/TAU_CLOUD_STORAGE.md §4). Flat, like `/ai`: a generated app reads
 * `data.error` as a string.
 */
export type StorageErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "invalid_key"
  | "invalid_request"
  | "file_too_large"
  | "storage_full"
  | "upload_incomplete"
  | "not_found"
  | "storage_suspended"
  | "rate_limit_exceeded"
  | "internal_error";

export class StorageError extends Error {
  constructor(
    readonly status: number,
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export const storageErrors = {
  invalidKey: (reason: string) => new StorageError(400, "invalid_key", `Invalid file key: ${reason}.`),
  invalid: (message: string) => new StorageError(400, "invalid_request", message),
  notFound: () => new StorageError(404, "not_found", "No such file."),
  incomplete: (message: string) => new StorageError(409, "upload_incomplete", message),
  suspended: () =>
    new StorageError(403, "storage_suspended", "Storage for this app has been suspended by tau."),
};
