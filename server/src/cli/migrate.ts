/** `npm --prefix server run db:migrate`: applies pending migrations. */
import {migrate} from '../db/migrate.ts';
import {runCli} from './common.ts';

await runCli(async db => {
  const result = await migrate(db, {log: line => console.log(line)});
  for (const file of result.alreadyApplied) console.log(`Ya aplicada ${file}`);
  console.log(
    result.applied.length
      ? `Listo: ${result.applied.length} migración(es) aplicada(s).`
      : 'Listo: la base de datos ya estaba al día.',
  );
});
