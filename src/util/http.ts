/** Error that carries an HTTP status + a stable machine-readable code. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" (no zone). Emit unambiguous ISO-8601 so every client parses it identically. */
export function isoUtc(ts: string | null | undefined): string | null {
  if (!ts) return null;
  if (ts.includes('T')) return ts;
  return ts.replace(' ', 'T') + 'Z';
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}
