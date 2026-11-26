/**
 * `npm --prefix server run db:seed [-- --reset-passwords]`: creates the pilot
 * organization, users and demo event and tasks (never again once the demo was
 * removed). New passwords are printed once.
 */
import {pendingMigrations} from '../db/migrate.ts';
import {seed} from '../seed/seed.ts';
import {runCli} from './common.ts';

const resetPasswords = process.argv.includes('--reset-passwords');

await runCli(async db => {
  const pending = await pendingMigrations(db);
  if (pending.length > 0) {
    console.error(
      `Faltan migraciones (${pending.map(p => p.file).join(', ')}). Ejecuta antes: npm --prefix server run db:migrate`,
    );
    process.exitCode = 1;
    return;
  }

  const result = await seed(db, {resetPasswords});
  console.log(
    `Organización: ${result.organization.name} (${result.organizationCreated ? 'creada' : 'ya existía'}, zona horaria ${result.organization.timezone})`,
  );
  console.log('');
  console.log('Usuarios:');
  const width = Math.max(...result.users.map(u => u.displayName.length));
  for (const u of result.users) {
    const name = u.displayName.padEnd(width);
    const role = u.role === 'guest' ? 'solo lectura' : 'miembro     ';
    const state = u.password
      ? `contraseña: ${u.password}${u.created ? '' : '  (restablecida)'}`
      : 'conserva su contraseña';
    console.log(`  ${name}  ${role}  ${state}`);
  }
  if (result.users.some(u => u.password)) {
    console.log('');
    console.log(
      'Apunta ahora las contraseñas nuevas: no se guardan en ningún sitio y no se volverán a mostrar.',
    );
    console.log(
      'Para generar otras: npm --prefix server run db:seed -- --reset-passwords',
    );
  }
  console.log('');
  if (result.demoRemovedAt) {
    const when = new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: result.organization.timezone,
    }).format(new Date(result.demoRemovedAt));
    console.log(
      `Datos de demostración: se borraron el ${when}; no se vuelven a crear.`,
    );
    return;
  }
  console.log(
    result.demoEventCreated
      ? 'Evento de demostración creado: «Navidad en la Plaza del Cristo» (2 dic 2026, 09:00–14:00).'
      : 'Evento de demostración: ya existía, no se ha tocado.',
  );
  console.log(
    result.demoTasksCreated > 0
      ? `Tareas de demostración creadas: ${result.demoTasksCreated} (montaje, entregas y desmontaje del 2 dic).`
      : 'Tareas de demostración: ya existían o no hay evento de demostración; no se ha tocado nada.',
  );
  console.log(
    result.demoContactsCreated + result.demoOffersCreated > 0
      ? `Contactos y catálogo de demostración creados: ${result.demoContactsCreated} personas y ${result.demoOffersCreated} ofertas (empresas y entidades ficticias, teléfonos +34 000 000 00X).`
      : 'Contactos y catálogo de demostración: ya existían o no hay evento de demostración; no se ha tocado nada.',
  );
});
