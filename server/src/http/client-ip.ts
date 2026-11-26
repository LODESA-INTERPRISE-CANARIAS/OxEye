/**
 * Client IP used as the per-IP login throttling key.
 *
 * Each reverse proxy appends the address of whoever connected to it to
 * X-Forwarded-For, so only the right-most `trustedHops` entries were written
 * by proxies we control; anything to their left came from the client and can
 * be forged. With `trustedHops` proxies in front of the API the client is the
 * entry `trustedHops` places from the right (1 hop: the last entry).
 *
 * If the header is missing, or shorter than the configured chain (the request
 * did not go through every proxy), the socket address is used instead: that
 * is conservative, because it never lets the client choose its own key.
 */
export function resolveClientIp(
  forwardedFor: string | undefined,
  socketAddress: string | undefined,
  trustedHops: number,
): string {
  const fallback = socketAddress?.trim() || 'unknown';
  if (trustedHops < 1 || !forwardedFor) return fallback;
  const entries = forwardedFor.split(',').map(s => s.trim());
  if (entries.length < trustedHops) return fallback;
  return entries[entries.length - trustedHops] || fallback;
}
