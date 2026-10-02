/**
 * The account page's data: the display name and picture (which live on the
 * `/auth/me` user, so the menu and Home pick up changes for free) and the
 * private activity graph.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";
import { authKeys } from "@/src/features/auth/queries";
import type { AuthUser } from "@/src/features/auth/types";

export const profileKeys = {
  activity: (timeZone: string) => ["account", "activity", timeZone] as const,
};

export interface ActivityDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  builds: number;
  ships: number;
  projects: number;
}

export interface Activity {
  timeZone: string;
  /** First cell of the grid, always a Sunday. */
  start: string;
  today: string;
  /** Sparse: only days with something on them. */
  days: ActivityDay[];
  totals: { builds: number; ships: number; projects: number; activeDays: number };
  streak: { current: number; longest: number; activeToday: boolean };
  /** Builds per local hour, 0–23. */
  hours: number[];
  /** Builds per local weekday, 0 = Sunday. */
  weekdays: number[];
  busiestDay: { date: string; count: number } | null;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useActivity() {
  const timeZone = browserTimeZone();
  return useQuery({
    queryKey: profileKeys.activity(timeZone),
    queryFn: async () =>
      (await api.get<Activity>("/account/activity", { params: { tz: timeZone } }))
        .data,
    staleTime: 5 * 60_000,
  });
}

/** Optimistic: the name shows up in the menu before the request lands. */
export function useUpdateDisplayName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (displayName: string | null) =>
      (
        await api.patch<{ displayName: string | null }>("/account/profile", {
          displayName,
        })
      ).data.displayName,
    onMutate: async (displayName) => {
      await qc.cancelQueries({ queryKey: authKeys.me });
      const previous = qc.getQueryData<{ user: AuthUser }>(authKeys.me);
      if (previous) {
        qc.setQueryData(authKeys.me, {
          user: { ...previous.user, displayName: displayName?.trim() || null },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(authKeys.me, ctx.previous);
    },
    onSuccess: (displayName) => {
      // The server's normalised version wins (trimmed, stripped, capped).
      qc.setQueryData<{ user: AuthUser }>(authKeys.me, (d) =>
        d ? { user: { ...d.user, displayName } } : d,
      );
    },
  });
}

export const AVATAR_SIZE = 256;
/** Phone photos are big; anything past this is almost certainly not a face. */
const AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Centre-crop and shrink to a 256px square in the browser, so the server only
 * ever stores a small image and never needs an image library. WebP where the
 * browser can encode it, PNG otherwise (both are accepted).
 */
export async function toAvatarBlob(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That's not an image. Try a PNG, JPEG or WebP.");
  }
  if (file.size > AVATAR_SOURCE_MAX_BYTES) {
    throw new Error("That image is huge. Something under 20MB, please.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Try a PNG or JPEG.");
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't process that image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.88),
  );
  if (!blob) throw new Error("Your browser couldn't process that image.");
  return blob;
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const blob = await toAvatarBlob(file);
      await api.put("/account/avatar", blob, {
        headers: { "Content-Type": blob.type || "image/png" },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.me }),
  });
}

export function useRemoveAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete("/account/avatar");
    },
    onMutate: () => {
      qc.setQueryData<{ user: AuthUser }>(authKeys.me, (d) =>
        d ? { user: { ...d.user, avatarPath: null } } : d,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: authKeys.me }),
  });
}
