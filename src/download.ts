// Reads a download, reporting the percent done when the server says how big it is.
export async function readBlob(response: Response, onProgress: (percent: number) => void) {
  const total = Number(response.headers?.get('content-length'));
  const reader = response.body?.getReader();
  if (!reader || !total) return response.blob();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round(received / total * 100)));
  }
  return new Blob(parts as BlobPart[], { type: response.headers.get('content-type') ?? '' });
}

// Saves a file the browser has in memory under the given name.
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
