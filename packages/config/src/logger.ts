/**
 * Structured logging: one JSON object per line, so a log collector can filter by level, service or
 * field. Text and fields are scrubbed of anything that looks like a secret before they are written,
 * so a token that slips into an error message is never stored in a log.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Shopify access tokens and app secrets
  [/\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]{8,}/g, 'shp***'],
  // a JWT (session tokens)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, 'jwt***'],
  // an Authorization header value
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer ***'],
  // the password in a connection string
  [/\b(postgres(?:ql)?|mysql|redis|smtps?|amqp):\/\/([^:/\s@]+):[^@\s]+@/gi, '$1://$2:***@'],
  // key=value pairs that name a secret
  [
    /\b([\w-]*(?:api[_-]?key|secret|token|password|passwd|authorization))(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    '$1$2***',
  ],
];

/** Removes anything that looks like a secret from a piece of text. */
export function redact(text: string): string {
  let out = text;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

const SECRET_KEYS =
  /^(authorization|cookie|set-cookie|password|passwd|secret|token|access_?token|api_?key|client_?secret)$/i;

/** Scrubs a value of any shape: strings by pattern, objects by key name, to a limited depth. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 4) return '[object]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '***' : redactValue(v, depth + 1);
  }
  return out;
}

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  /** where lines go; defaults to stdout for info and below, stderr for warn and error */
  write?: (level: Level, line: string) => void;
  /** lowest level written; defaults to info */
  level?: Level;
  now?: () => Date;
}

export function createLogger(service: string, opts: LoggerOptions = {}): Logger {
  const min = ORDER[opts.level ?? 'info'];
  const now = opts.now ?? (() => new Date());
  const write =
    opts.write ??
    ((level: Level, line: string) => {
      if (level === 'warn' || level === 'error') process.stderr.write(line + '\n');
      else process.stdout.write(line + '\n');
    });
  const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    // fixed keys last, so a field named "level" or "msg" cannot overwrite them
    const line = JSON.stringify({
      ...(fields ? (redactValue(fields) as Record<string, unknown>) : {}),
      time: now().toISOString(),
      level,
      service,
      msg: redact(msg),
    });
    write(level, line);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
