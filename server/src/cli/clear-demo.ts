/** `npm --prefix server run db:clear-demo`: deletes every demo record. */
import {clearDemo} from '../demo/service.ts';
import {runCli} from './common.ts';

await runCli(async db => {
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
});
