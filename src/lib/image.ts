import type { Img, PixelGrid } from './sprite';

export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

export function gridToDataUrl(g: PixelGrid, scale = 4): string {
  const c = document.createElement('canvas');
  c.width = Math.max(1, g.w * scale);
  c.height = Math.max(1, g.h * scale);
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const p = g.px[y * g.w + x];
      if (!p) continue;
      ctx.fillStyle = p;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  return c.toDataURL('image/png');
}

export function download(data: Uint8Array | Blob, filename: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type { Img };
