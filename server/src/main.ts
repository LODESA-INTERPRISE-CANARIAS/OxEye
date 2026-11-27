/**
 * API entry point: `npm --prefix server run dev` locally, `node src/main.ts`
 * in the container. Configuration comes only from the environment.
 */
import {serve} from '@hono/node-server';
import {getConnInfo} from '@hono/node-server/conninfo';
import type {Context} from 'hono';
import {createApp} from './app.ts';
import {ConfigError, loadConfig} from './config.ts';
import {migrate} from './db/migrate.ts';
import {DbLockedError, isPgliteUrl, openDb} from './db/open.ts';
import {resolveClientIp} from './http/client-ip.ts';
import {startRenewalTimer} from './offer-terms/renewals.ts';

function log(line: string): void {
  console.log(`${new Date().toISOString()} ${line}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await openDb(config.databaseUrl);

  // The local embedded database always starts up to date: nobody can run
  // db:migrate while the API holds it.
  if (config.migrateOnStart || isPgliteUrl(config.databaseUrl)) {
    const result = await migrate(db, {log});
    log(
      result.applied.length
        ? `Migraciones aplicadas: ${result.applied.join(', ')}`
        : 'Base de datos al día: no hay migraciones pendientes.',
    );
  }

  const clientIp = (c: Context): string => {
    let socketAddress: string | undefined;
    try {
      socketAddress = getConnInfo(c).remote.address;
    } catch {
      socketAddress = undefined;
    }
    return resolveClientIp(
      config.trustProxyHops > 0 ? c.req.header('X-Forwarded-For') : undefined,
      socketAddress,
      config.trustProxyHops,
    );
  };

  const app = createApp({db, config, clientIp, log});
  const server = serve(
    {fetch: app.fetch, port: config.port, hostname: config.host},
    info => {
      log(
        `API del Gestor logístico escuchando en http://${info.address}:${info.port} (${config.nodeEnv})`,
      );
      if (config.corsOrigins.length === 0) {
        log(
          'Aviso: CORS_ORIGINS está vacío; solo se aceptan peticiones del mismo origen.',
        );
      }
      // Host and port only: never the account, the password or the inbox.
      if (config.mail.smtp) {
        log(
          `Correo de cuentas: SMTP ${config.mail.smtp.host}:${config.mail.smtp.port}`,
        );
      } else if (config.mail.printLinks) {
        log(
          'Correo de cuentas: sin SMTP; no se envía nada (NODE_ENV=development: los enlaces aparecen en este registro; nunca en un servidor compartido).',
        );
      } else {
        log(
          'Aviso: correo de cuentas sin SMTP. No se envía nada y los enlaces de recuperación no aparecen en el registro; configura SMTP_HOST, o NODE_ENV=development solo en un equipo local.',
        );
      }
    },
  );

  // Revisión 1 · E6: renegotiation tasks, now and every hour.
  const stopRenewals = startRenewalTimer(db, log);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    stopRenewals();
    log(`${signal} recibido: cerrando el servidor…`);
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  if (err instanceof ConfigError || err instanceof DbLockedError) {
    console.error(err.message);
  } else {
    const e = err instanceof Error ? err : new Error(String(err));
    // Never print the connection string: it contains the database password.
    console.error(`No se pudo arrancar el servidor: ${e.name}: ${e.message}`);
  }
  process.exit(1);
});
