/**
 * Compare the storage bucket with the table that lists its files
 * (doc/TAU_CLOUD_STORAGE.md 4.5). Two kinds of drift:
 *
 *  - an object with no row: bytes nobody can reach and nobody pays attention to;
 *  - a READY row with no object: a file the owner sees that will not open.
 *
 * Reports by default. `fix` deletes the orphaned objects and the dead rows.
 * `diffStorage` is pure so both kinds are testable at their edges.
 */
import { prisma } from "@/lib/prisma";
import { deleteStorageObjects, listStorageKeys, STORAGE_PREFIX, storageObjectKey } from "@/lib/storageBucket";

export interface RowRef {
  id: string;
  projectId: string;
  env: "PREVIEW" | "LIVE";
  key: string;
  status: "PENDING" | "READY" | "DELETING";
}

export interface StorageDiff {
  /** Bucket keys that no row accounts for. */
  orphanObjects: string[];
  /** READY rows whose object is not in the bucket. */
  missingObjects: RowRef[];
}

export function diffStorage(objectKeys: readonly string[], rows: readonly RowRef[]): StorageDiff {
  const have = new Set(objectKeys);
  const expected = new Map(rows.map((r) => [storageObjectKey(r.projectId, r.env, r.id), r]));
  return {
    orphanObjects: objectKeys.filter((k) => !expected.has(k)),
    missingObjects: rows.filter((r) => r.status === "READY" && !have.has(storageObjectKey(r.projectId, r.env, r.id))),
  };
}

export interface ReconcileDeps {
  listObjects: () => Promise<string[]>;
  loadRows: () => Promise<RowRef[]>;
  deleteObjects: (keys: string[]) => Promise<string[]>;
  deleteRows: (ids: string[]) => Promise<number>;
}

const realDeps: ReconcileDeps = {
  listObjects: () => listStorageKeys(STORAGE_PREFIX),
  loadRows: () =>
    prisma.storageObject.findMany({ select: { id: true, projectId: true, env: true, key: true, status: true } }),
  deleteObjects: deleteStorageObjects,
  deleteRows: async (ids) => (await prisma.storageObject.deleteMany({ where: { id: { in: ids }, status: "READY" } })).count,
};

export interface ReconcileResult extends StorageDiff {
  checkedObjects: number;
  checkedRows: number;
  fixed: { objectsDeleted: number; rowsDeleted: number } | null;
}

export async function reconcileStorage(opts: { fix: boolean }, deps: ReconcileDeps = realDeps): Promise<ReconcileResult> {
  const [objectKeys, rows] = await Promise.all([deps.listObjects(), deps.loadRows()]);
  const diff = diffStorage(objectKeys, rows);
  let fixed: ReconcileResult["fixed"] = null;
  if (opts.fix) {
    const failed = diff.orphanObjects.length > 0 ? await deps.deleteObjects(diff.orphanObjects) : [];
    const rowsDeleted = diff.missingObjects.length > 0 ? await deps.deleteRows(diff.missingObjects.map((r) => r.id)) : 0;
    fixed = { objectsDeleted: diff.orphanObjects.length - failed.length, rowsDeleted };
  }
  return { ...diff, checkedObjects: objectKeys.length, checkedRows: rows.length, fixed };
}
