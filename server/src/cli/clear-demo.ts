/**
 * `npm --prefix server run db:clear-demo`: deletes every demo record and
 * marks every organization so the seed never re-creates the demo.
 */
import {pendingMigrations} from '../db/migrate.ts';
import {clearDemo} from '../demo/service.ts';
import {runCli} from './common.ts';

await runCli(async db => {
  const pending = await pendingMigrations(db);
  if (pending.length > 0) {
    console.error(
      `Faltan migraciones (${pending.map(p => p.file).join(', ')}). Ejecuta antes: npm --prefix server run db:migrate`,
    );
    process.exitCode = 1;
    return;
  }

  const {removed} = await clearDemo(db, {
    organizationId: null,
    actorId: null,
    now: new Date(),
  });
  console.log(
    removed > 0
      ? `Datos de demostración eliminados: ${removed} registro(s).`
      : 'No había datos de demostración.',
  );
  console.log('db:seed ya no los volverá a crear.');
});
