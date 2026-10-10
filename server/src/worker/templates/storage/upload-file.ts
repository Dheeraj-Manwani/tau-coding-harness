// Upload a file from the browser, with progress. Written by tau when storage
// was turned on. It calls this app's own two routes (`/api/files/upload-url` and
// `/api/files/complete`, see the storage guide) and sends the bytes straight to
// storage. It never sees a storage key.

export interface UploadedFile {
  id: string
  key: string
  name: string
  contentType: string
  size: number
  createdAt: string
}

export class UploadError extends Error {
  /** tau's code when the server passed it on, e.g. `storage_full`, `file_too_large`. */
  code: string
  constructor(message: string, code = 'upload_failed') {
    super(message)
    this.name = 'UploadError'
    this.code = code
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!res.ok) throw new UploadError(data.error ?? 'The upload failed.', data.code)
  return data as T
}

/** `fetch` cannot report upload progress, so the bytes go by `XMLHttpRequest`. */
function put(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadError('The file could not be uploaded.'))
    xhr.onerror = () => reject(new UploadError('The connection was lost during the upload.'))
    xhr.onabort = () => reject(new UploadError('The upload was cancelled.', 'aborted'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}

export async function uploadFile(
  file: File,
  opts: {
    onProgress?: (fraction: number) => void
    signal?: AbortSignal
    /** Extra fields for the app's own route, e.g. which record the file belongs to. */
    extra?: Record<string, unknown>
  } = {},
): Promise<UploadedFile> {
  const { id, uploadUrl, headers } = await post<{
    id: string
    uploadUrl: string
    headers: Record<string, string>
  }>('/api/files/upload-url', {
    name: file.name,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    ...opts.extra,
  })
  await put(uploadUrl, headers, file, opts.onProgress, opts.signal)
  return (await post<{ file: UploadedFile }>('/api/files/complete', { id })).file
}
