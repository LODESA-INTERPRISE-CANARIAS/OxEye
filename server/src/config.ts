/**
 * Runtime configuration, read only from the environment (server/.env in
 * development, the host's environment on the external server). The same code
 * runs in both; nothing here assumes a laptop.
 */
import {readFileSync} from 'node:fs';
import {z} from 'zod';

export type NodeEnv = 'development' | 'production' | 'test';

export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  /** Exact browser origins allowed to call the API cross-origin. */
  corsOrigins: string[];
  /** Sliding session lifetime in days. */
  sessionDays: number;
  nodeEnv: NodeEnv;
  /** Apply pending migrations when the API starts. */
  migrateOnStart: boolean;
  /**
   * Reverse proxies in front of the API that append to X-Forwarded-For.
   * 0 ignores the header; N takes the client IP from the N-th entry from the
   * right (see http/client-ip.ts).
   */
  trustProxyHops: number;
}

/** Upper bound for TRUST_PROXY; a real deployment has one or two proxies. */
export const MAX_TRUST_PROXY_HOPS = 5;

const DEV_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform(v => v === 'true' || v === '1');

/** `false`/`0`/empty: no proxy; `true`: one proxy; `1`…`5`: that many. */
const proxyHops = z
  .string()
  .trim()
  .regex(/^(true|false|\d*)$/, {
    error: `TRUST_PROXY debe ser false, true o el número de proxies inversos delante de la API (0 a ${MAX_TRUST_PROXY_HOPS})`,
  })
  .optional()
  .transform(v =>
    v === undefined || v === '' || v === 'false'
      ? 0
      : v === 'true'
        ? 1
        : Number(v),
  )
  .refine(n => n <= MAX_TRUST_PROXY_HOPS, {
    error: `TRUST_PROXY admite como máximo ${MAX_TRUST_PROXY_HOPS} proxies inversos`,
  });

const envSchema = z.object({
  DATABASE_URL: z
    .string({error: 'DATABASE_URL es obligatoria'})
    .trim()
    .regex(/^postgres(ql)?:\/\//, {
      error: 'DATABASE_URL debe empezar por postgres:// o postgresql://',
    }),
  HOST: z.string().trim().min(1).optional(),
  PORT: z.coerce
    .number({error: 'PORT debe ser un número'})
    .int()
    .min(1)
    .max(65535)
    .optional(),
  CORS_ORIGINS: z.string().optional(),
  SESSION_DAYS: z.coerce
    .number({error: 'SESSION_DAYS debe ser un número'})
    .int()
    .min(1)
    .max(365)
    .optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  MIGRATE_ON_START: bool,
  TRUST_PROXY: proxyHops,
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parses the environment; throws ConfigError with every problem found. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      i => `- ${i.path.join('.') || 'entorno'}: ${i.message}`,
    );
    throw new ConfigError(
      'Configuración no válida (copia server/.env.example a server/.env y revísala):\n' +
        lines.join('\n'),
    );
  }
  const e = parsed.data;
  const nodeEnv: NodeEnv = e.NODE_ENV ?? 'development';
  const corsOrigins =
    e.CORS_ORIGINS !== undefined
      ? parseOrigins(e.CORS_ORIGINS)
      : nodeEnv === 'production'
        ? []
        : DEV_CORS_ORIGINS;
  return {
    databaseUrl: e.DATABASE_URL,
    host: e.HOST ?? '0.0.0.0',
    port: e.PORT ?? 8787,
    corsOrigins,
    sessionDays: e.SESSION_DAYS ?? 30,
    nodeEnv,
    migrateOnStart: e.MIGRATE_ON_START,
    trustProxyHops: e.TRUST_PROXY,
  };
}

/** Comma-separated list of origins; trailing slashes removed, `*` refused. */
export function parseOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const o of origins) {
    if (o === '*' || !/^https?:\/\/[^/\s]+$/.test(o)) {
      throw new ConfigError(
        `CORS_ORIGINS contiene un origen no válido: «${o}». Usa direcciones completas como https://equipo.example.org`,
      );
    }
  }
  return origins;
}

let cachedVersion: string | undefined;

/** Version of the server package, reported by /api/health. */
export function appVersion(): string {
  if (cachedVersion === undefined) {
    try {
      const pkg = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      ) as {version?: unknown};
      cachedVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    } catch {
      cachedVersion = '0.0.0';
    }
  }
  return cachedVersion;
}
