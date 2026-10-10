# Storage guide — keeping users' files

This works only after `enable_storage` has been called for the app. That call puts the credentials in the server's environment and writes two helper files; reading this guide does not.

Files go from the visitor's browser straight to tau's storage, never through this app's server. The server only decides who may upload, picks the file's name, and asks tau for addresses. Never write an upload to the server's disk or keep a file as base64 in a table or the browser: both are lost when the app is rebuilt, and only storage survives.

Two helper files already exist. Use them as they are:

- `server/storage.ts` — server code only. `createUpload`, `completeUpload`, `saveFile`, `listFiles`, `fileInfo`, `fileUrl`, `fileUrls`, `moveFile`, `deleteFiles`, `storageUsage`. A failure throws a `StorageError` with a `code`.
- `src/lib/uploadFile.ts` — frontend. `uploadFile(file, { onProgress })` does the whole upload; progress runs from 0 to 1.

## The upload
1. The browser calls `uploadFile(file)`, which posts the name, type and size to your `/api/files/upload-url`.
2. That route decides whether this visitor may upload, chooses the key, and calls `createUpload`. The browser gets `{ id, uploadUrl, headers }`.
3. The browser `PUT`s the bytes to `uploadUrl` with exactly those headers.
4. The browser posts the `id` to your `/api/files/complete`, which calls `completeUpload`. The file exists only after this.

## The routes
In `server/index.ts`. Change `folderFor` to fit the app; the rest can stay.

```ts
import { StorageError, completeUpload, createUpload, deleteFiles, fileUrl, listFiles } from './storage'

// With sign-in: `users/${user.id}/`. Without it: one shared folder.
const folderFor = (_c: unknown) => 'uploads/'
const fail = (c: any, err: unknown) => {
  if (!(err instanceof StorageError)) throw err
  return c.json({ error: err.message, code: err.code }, [403, 404, 413].includes(err.status) ? err.status : 400)
}

app.post('/api/files/upload-url', async (c) => {
  const { name, contentType, size } = await c.req.json<{ name: string; contentType: string; size: number }>()
  const safe = String(name ?? 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file'
  try { // the browser never picks the key
    const { id, uploadUrl, headers } = await createUpload({ key: `${folderFor(c)}${crypto.randomUUID()}/${safe}`, contentType, size })
    return c.json({ id, uploadUrl, headers })
  } catch (err) { return fail(c, err) }
})

app.post('/api/files/complete', async (c) => {
  try { return c.json({ file: await completeUpload((await c.req.json<{ id: string }>()).id) }) }
  catch (err) { return fail(c, err) }
})

app.get('/api/files', async (c) => {
  try { return c.json(await listFiles({ prefix: folderFor(c), cursor: c.req.query('cursor') })) }
  catch (err) { return fail(c, err) }
})

// `<img src="/api/files/view?key=…">` and download links (`&download=1`).
app.get('/api/files/view', async (c) => {
  const key = c.req.query('key') ?? ''
  if (!key.startsWith(folderFor(c))) return c.json({ error: 'Not found' }, 404)
  try { return c.redirect((await fileUrl(key, { download: c.req.query('download') === '1' })).url, 302) }
  catch (err) { return fail(c, err) }
})

app.delete('/api/files', async (c) => {
  const { key } = await c.req.json<{ key: string }>()
  if (!key.startsWith(folderFor(c))) return c.json({ error: 'Not found' }, 404)
  try { return c.json(await deleteFiles({ keys: [key] })) }
  catch (err) { return fail(c, err) }
})
```

The frontend:

```ts
import { uploadFile, UploadError } from '@/lib/uploadFile'
try {
  const file = await uploadFile(input.files[0], { onProgress: setProgress }) // { id, key, name, contentType, size, createdAt }
} catch (err) {
  setError(err instanceof UploadError ? err.message : 'The upload failed.')
}
```

## Rules
- **The storage key never reaches the browser.** Only `server/storage.ts` reads `TAU_STORAGE_KEY`. Never log or return it.
- **The server decides.** It says who may upload and read, and chooses every key. Never use a key from the browser without checking it starts with that visitor's folder.
- **Cap what one visitor can do.** Check size and file count in the route before `createUpload`. Where the app has sign-in, require it.
- **A key is a name, not a path.** `users/42/avatar.png`. Slashes only matter for `listFiles({ prefix })`. Uploading to an existing key replaces that file.
- **Keep a file's `key` in your own table** when it belongs to a record. Never its contents.
- **Addresses expire** (15 minutes). Reuse one until `expiresAt` rather than asking per render; `fileUrls` signs a list. For `<img>`, the view route above is simplest.
- **Pictures, PDF, audio, video and plain text open in the browser; everything else downloads.** HTML and SVG always download, by design. To show a picture, upload it as `image/png`, `jpeg`, `webp` or `gif`.
- **Show friendly messages** for `storage_full` and `file_too_large`; the error's `message` states the limit.
- A file the server makes (an export, a PDF) goes through `saveFile(key, bytes, contentType)`.
- `storageUsage()` returns `usedBytes`, `quotaBytes`, `maxFileBytes`. Over the allowance, uploads are refused; listing, downloading and deleting still work.

## Check your work
```bash
curl -s -X POST localhost:3000/api/files/upload-url -H 'Content-Type: application/json' -d '{"name":"a.txt","contentType":"text/plain","size":5}'
curl -s -X PUT "<uploadUrl>" -H 'Content-Type: text/plain' --data-binary 'hello'
curl -s -X POST localhost:3000/api/files/complete -H 'Content-Type: application/json' -d '{"id":"<id>"}'
curl -s localhost:3000/api/files
```
