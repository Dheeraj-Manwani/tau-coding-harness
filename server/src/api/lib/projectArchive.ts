import { ZipArchive } from "archiver";

/** Archive manifest blobs as bytes so images and fonts survive unchanged. */
export async function createProjectArchive(
  files: { path: string; contentHash: string }[],
  read: (hash: string) => Promise<Uint8Array>,
): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  // Attach a handler immediately, including while blobs are still loading.
  void completed.catch(() => {});
  try {
    let bytes = 0;
    for (const file of files) {
      if (!file.path || file.path.includes("\\") || file.path.includes(":") ||
          file.path.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("Invalid archive path");
      }
      const body = await read(file.contentHash);
      bytes += body.byteLength;
      if (bytes > 100 * 1024 * 1024) throw new Error("Project exceeds the 100 MB download limit");
      archive.append(Buffer.from(body), { name: file.path });
    }
    await archive.finalize();
    return await completed;
  } catch (error) {
    archive.abort();
    throw error;
  }
}
