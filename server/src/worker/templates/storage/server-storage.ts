// tau Cloud Storage, for this app's SERVER. Written by tau when storage was
// turned on; safe to read, not meant to be rewritten. Never import it from
// frontend code: it holds the storage key.
//
// Bytes never pass through this server. A file goes from the visitor's browser
// straight to storage, through an address `createUpload` hands out. This file
// only talks to tau about which files exist.

export interface StoredFile {
  id: string
  /** This app's name for the file, e.g. `users/42/avatar.png`. */
  key: string
  /** The last part of the key. */
  name: string
  contentType: string
  size: number
  metadata: unknown
  createdAt: string
}

/** Thrown for any failed call. `code` is tau's, e.g. `storage_full`, `file_too_large`, `not_found`. */
export class StorageError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'StorageError'
    this.code = code
    this.status = status
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const base = process.env.TAU_STORAGE_URL
  const key = process.env.TAU_STORAGE_KEY
  if (!base || !key) {
    throw new StorageError('File storage is not configured for this app.', 'not_configured', 500)
  }
  const res = await fetch(base.replace(/\/+$/, '') + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!res.ok) {
    throw new StorageError(data.error ?? 'Storage request failed.', data.code ?? 'storage_error', res.status)
  }
  return data as T
}

export interface Upload {
  id: string
  key: string
  /** Give this to the browser. It `PUT`s the file here. Valid for about 15 minutes. */
  uploadUrl: string
  method: 'PUT'
  /** Headers the `PUT` must send exactly as given. */
  headers: Record<string, string>
  expiresAt: string
}

/** Step 1 of an upload: reserve a name and get an address to `PUT` the bytes to. */
export function createUpload(input: {
  key: string
  contentType: string
  size: number
  metadata?: unknown
}): Promise<Upload> {
  return call('POST', '/uploads', input)
}

/** Step 3: after the bytes are uploaded, confirm it. The file only exists once this succeeds. */
export async function completeUpload(id: string): Promise<StoredFile> {
  return (await call<{ file: StoredFile }>('POST', `/uploads/${encodeURIComponent(id)}/complete`)).file
}

/** Save a file this server made itself (an export, a generated PDF). */
export async function saveFile(
  key: string,
  bytes: Uint8Array | ArrayBuffer | string,
  contentType: string,
  metadata?: unknown,
): Promise<StoredFile> {
  const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes)
  const upload = await createUpload({ key, contentType, size: body.byteLength, metadata })
  const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body })
  if (!put.ok) throw new StorageError('The file could not be stored.', 'upload_failed', 502)
  return completeUpload(upload.id)
}

/** Files whose key starts with `prefix`, in key order. Pass `nextCursor` back to get the next page. */
export function listFiles(
  opts: { prefix?: string; cursor?: string; limit?: number } = {},
): Promise<{ files: StoredFile[]; nextCursor: string | null }> {
  const q = new URLSearchParams()
  if (opts.prefix) q.set('prefix', opts.prefix)
  if (opts.cursor) q.set('cursor', opts.cursor)
  if (opts.limit) q.set('limit', String(opts.limit))
  const qs = q.toString()
  return call('GET', `/files${qs ? `?${qs}` : ''}`)
}

export async function fileInfo(key: string): Promise<StoredFile> {
  return (await call<{ file: StoredFile }>('GET', `/files/info?key=${encodeURIComponent(key)}`)).file
}

/**
 * A short-lived address the browser can load the file from (`<img src>`, a
 * download link). Reuse it until `expiresAt`; use `fileUrls` for a list.
 * `download: true` forces a save-as even for a picture.
 */
export function fileUrl(
  key: string,
  opts: { expiresIn?: number; download?: boolean } = {},
): Promise<{ url: string; expiresAt: string }> {
  return call('POST', '/files/url', { key, ...opts })
}

/** Addresses for up to 100 files in one call. A key with no file gets `url: null`. */
export function fileUrls(
  keys: string[],
  opts: { expiresIn?: number } = {},
): Promise<{ urls: { key: string; url: string | null }[]; expiresAt: string }> {
  return call('POST', '/files/urls', { keys, ...opts })
}

/** Rename. A file already at the new name is replaced. */
export async function moveFile(from: string, to: string): Promise<StoredFile> {
  return (await call<{ file: StoredFile }>('POST', '/files/move', { from, to })).file
}

/** Delete by keys, or everything under a prefix. */
export function deleteFiles(target: { keys: string[] } | { prefix: string }): Promise<{ deleted: number }> {
  return call('POST', '/files/delete', target)
}

export function storageUsage(): Promise<{
  usedBytes: number
  quotaBytes: number
  fileCount: number
  maxFileBytes: number
}> {
  return call('GET', '/usage')
}
