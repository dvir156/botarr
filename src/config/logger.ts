import { randomUUID } from 'node:crypto';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = {
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

function write(level: LogLevel, msg: string, fields: LogFields | undefined) {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(line);
}

function create(fields: LogFields): Logger {
  return {
    info: (msg, more) => write('info', msg, { ...fields, ...(more ?? {}) }),
    warn: (msg, more) => write('warn', msg, { ...fields, ...(more ?? {}) }),
    error: (msg, more) => write('error', msg, { ...fields, ...(more ?? {}) }),
    child: (more) => create({ ...fields, ...more })
  };
}

export const logger: Logger = create({});

export function createRequestId(): string {
  return randomUUID();
}

