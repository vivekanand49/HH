// Shrink a phone photo before upload: max 1600 px on the long side, JPEG 80%.
// A 4 MB camera photo becomes roughly 200–400 KB, which uploads on 2G.
export async function compressImage(file, { maxSide = 1600, quality = 0.8 } = {}) {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob && blob.size < file.size ? blob : file;
}
