/**
 * `npm --prefix server run cuenta:recuperar -- <usuario>`: a new provisional
 * password for one account, printed once. Needs access to the machine that
 * runs the server; see `src/account/recover.ts`.
 */
import {pendingMigrations} from '../db/migrate.ts';
import {recoverAccount, RecoverError} from '../account/recover.ts';
import {runCli} from './common.ts';

const username = process.argv
  .slice(2)
  .filter(a => a !== '--')
  .join(' ');

await runCli(async db => {
  const pending = await pendingMigrations(db);
  if (pending.length > 0) {
    console.error(
      `Faltan migraciones (${pending.map(p => p.file).join(', ')}). Ejecuta antes: npm --prefix server run db:migrate`,
    );
    process.exitCode = 1;
    return;
  }
  try {
    const result = await recoverAccount(db, username, new Date());
    console.log(`Cuenta recuperada: ${result.username}`);
    console.log(`Contraseña nueva: ${result.password}`);
    console.log('');
    console.log(
      'Apúntala ahora: no se guarda en ningún sitio y no se volverá a mostrar.',
    );
    if (result.provisional) {
      console.log(
        'Es provisional: cámbiala al entrar (hasta entonces no ves presupuestos ni la administración).',
      );
    }
    if (result.developer) {
      console.log(
        'Roles de desarrollo comprobados: administración + desarrollo.',
      );
    }
    console.log(
      'Se han cerrado sus sesiones abiertas y queda anotado en su historial de seguridad.',
    );
  } catch (err) {
    if (err instanceof RecoverError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
});
