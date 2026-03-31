export function encodeCursor(id: string, createdAt: string): string {
  return Buffer.from(JSON.stringify({ id, created_at: createdAt })).toString('base64url');
}

export function decodeCursor(cursor: string): { id: string; createdAt: string } {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
    id: string;
    created_at: string;
  };
  return { id: parsed.id, createdAt: parsed.created_at };
}
