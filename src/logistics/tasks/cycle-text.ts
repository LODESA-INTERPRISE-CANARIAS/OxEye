/**
 * Why a task cannot wait for another one: the chain of «depende de» links
 * that already leads back to the task being edited, in plain words and with
 * real task titles. Pure, for the task sheet and the tests.
 */

/**
 * `chain`: titles from the candidate to the last task before the one being
 * edited (the `dependencyPath` without its last id). «No se puede: «Montaje
 * de escenario» ya depende de «Entrega de vallas», que a su vez depende de
 * esta tarea.»
 */
export function cycleText(chain: readonly string[]): string {
  const [first, next, ...rest] = chain.map(t => `«${t}»`);
  if (!first) return 'No se puede: crearía un círculo de dependencias.';
  if (!next) return `No se puede: ${first} ya depende de esta tarea.`;
  const links = rest.map(t => `, que depende de ${t}`).join('');
  return `No se puede: ${first} ya depende de ${next}${links}, que a su vez depende de esta tarea.`;
}
