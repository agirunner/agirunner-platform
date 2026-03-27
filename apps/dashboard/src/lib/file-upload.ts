export async function fileToBase64(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(bytes));
}

export async function buildFileUploadPayloads(
  files: File[],
): Promise<
  Array<{
    file_name: string;
    content_base64: string;
    content_type?: string;
  }>
> {
  return Promise.all(
    files.map(async (file) => ({
      file_name: file.name,
      content_base64: await fileToBase64(file),
      content_type: file.type || undefined,
    })),
  );
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}
