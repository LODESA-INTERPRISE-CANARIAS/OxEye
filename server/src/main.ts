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
import {createPostgresDb} from './db/postgres.ts';
import {resolveClientIp} from './http/client-ip.ts';

function log(line: string): void {
  console.log(`${new Date().toISOString()} ${line}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPostgresDb(config.databaseUrl);

  if (config.migrateOnStart) {
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
    },
  );

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
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
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    const e = err instanceof Error ? err : new Error(String(err));
    // Never print the connection string: it contains the database password.
    console.error(`No se pudo arrancar el servidor: ${e.name}: ${e.message}`);
  }
  process.exit(1);
});
