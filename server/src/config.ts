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
  /** E4: account e-mails (recovery, verification). */
  mail: MailConfig;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS from the start (port 465); false = STARTTLS (port 587). */
  secure: boolean;
  user: string | null;
  pass: string | null;
}

export interface MailConfig {
  /** Null: no SMTP; e-mails go to the console transport (never sent). */
  smtp: SmtpConfig | null;
  /** «Ox Eye <cuenta@example.org>»; required with SMTP. */
  from: string | null;
  /**
   * Project inbox for recovery links of accounts without a verified
   * personal e-mail. Never written in the repository, never revealed in a
   * response or a log.
   */
  recoveryFallback: string | null;
  /** Web address the links point to; else the request Origin (if allowed). */
  publicAppUrl: string | null;
  /**
   * Without SMTP, write whole messages (with their links) to the server log.
   * Only when NODE_ENV=development is set explicitly: a server started
   * without NODE_ENV never prints a usable reset link.
   */
  printLinks: boolean;
}

export const NO_MAIL: MailConfig = {
  smtp: null,
  from: null,
  recoveryFallback: null,
  publicAppUrl: null,
  printLinks: false,
};

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
    .regex(/^(postgres(ql)?:\/\/|pglite:)/, {
      error:
        'DATABASE_URL debe empezar por postgres://, postgresql:// o pglite: (base local sin Docker)',
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
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z
    .string()
    .trim()
    .regex(/^\d*$/, {error: 'SMTP_PORT debe ser un número (465 o 587)'})
    .optional()
    .transform(v => (v ? Number(v) : undefined))
    .refine(v => v === undefined || (v >= 1 && v <= 65535), {
      error: 'SMTP_PORT debe estar entre 1 y 65535',
    }),
  SMTP_SECURE: z.enum(['true', 'false', '1', '0', '']).optional(),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().trim().optional(),
  RECOVERY_FALLBACK_EMAIL: z
    .string()
    .trim()
    .refine(v => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      error: 'RECOVERY_FALLBACK_EMAIL debe ser una dirección de correo',
    })
    .optional(),
  PUBLIC_APP_URL: z.string().trim().optional(),
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
  if (nodeEnv === 'production' && e.DATABASE_URL.startsWith('pglite:')) {
    throw new ConfigError(
      'Configuración no válida: la base local pglite: es solo para desarrollo; en producción usa PostgreSQL (postgres://…).',
    );
  }
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
    mail: mailConfig(e),
  };
}

function mailConfig(e: z.output<typeof envSchema>): MailConfig {
  const host = e.SMTP_HOST || null;
  const from = e.MAIL_FROM || null;
  if (host && !from) {
    throw new ConfigError(
      'Configuración no válida: con SMTP_HOST hace falta MAIL_FROM (por ejemplo «Ox Eye <cuenta@example.org>»).',
    );
  }
  let publicAppUrl: string | null = null;
  if (e.PUBLIC_APP_URL) {
    const url = e.PUBLIC_APP_URL.replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/.test(url)) {
      throw new ConfigError(
        `PUBLIC_APP_URL no es una dirección web válida: «${url}». Usa por ejemplo https://equipo.example.org/logistica`,
      );
    }
    publicAppUrl = url;
  }
  const secureRaw = e.SMTP_SECURE;
  const port = e.SMTP_PORT;
  const secure =
    secureRaw === undefined || secureRaw === ''
      ? (port ?? 465) === 465
      : secureRaw === 'true' || secureRaw === '1';
  return {
    smtp: host
      ? {
          host,
          port: port ?? (secure ? 465 : 587),
          secure,
          user: e.SMTP_USER || null,
          pass: e.SMTP_PASS || null,
        }
      : null,
    from,
    recoveryFallback: e.RECOVERY_FALLBACK_EMAIL || null,
    publicAppUrl,
    printLinks: e.NODE_ENV === 'development',
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
