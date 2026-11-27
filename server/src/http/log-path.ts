/**
 * The request path as it may appear in a log line. Revisión 1 · E7: supplier
 * links send their token in the body; a client that still puts one in the
 * address (`/api/public/requests/<token>…`, which answers 404) never gets it
 * written to the log: anything token-like after the prefix becomes «…».
 */
export function logPath(path: string): string {
  return path.replace(
    /^(\/api\/public\/(?:requests|offers)\/)[A-Za-z0-9_-]{20,}/,
    '$1…',
  );
}
