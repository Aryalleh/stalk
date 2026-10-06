import { randomSlug } from "./db";

// Public images in R2, by key prefix: p/ products, a/ avatars, s/ shop logos and covers.
// Receipts (r/) are private and never served by /img.
export const PUBLIC_IMAGE = /^(p|a|s|b)\/[\w/.-]+$/;
export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The uploaded file in a form field, or null when the field is empty. */
export function fileField(v: unknown): File | null {
  return v instanceof File && v.size > 0 ? v : null;
}

export function imageError(file: File, maxMb: number, label = "تصویر") {
  if (!IMAGE_TYPES[file.type]) return `${label} باید JPG، PNG یا WebP باشد.`;
  if (file.size > maxMb * 1024 * 1024) return `حجم ${label} حداکثر ${maxMb.toLocaleString("fa-IR")} مگابایت است.`;
  return "";
}

export async function storeImage(images: R2Bucket, file: File, prefix: string) {
  const key = `${prefix}/${randomSlug(16)}.${IMAGE_TYPES[file.type]}`;
  await images.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}
