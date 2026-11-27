/**
 * Sends account e-mails after the request has answered, so the response
 * time never depends on the mail server (a recovery request for an existing
 * account must look exactly like one for an unknown name). Failures are
 * logged without the address or the text.
 */
import type {MailMessage, MailTransport} from './transport.ts';

export interface MailOutbox {
  /** True when messages really leave the server. */
  readonly configured: boolean;
  /** Sends in the background. */
  queue(message: MailMessage): void;
  /**
   * Runs `work` in the background, after the answer, and sends the message
   * it returns (if any). For anonymous requests whose database work must not
   * show in the response time (recovery: known and unknown names cost the
   * same). Failures are logged without details.
   */
  defer(work: () => Promise<MailMessage | null>): void;
  /** Sends now; throws if the transport fails. */
  send(message: MailMessage): Promise<void>;
  /** Waits for every queued message (tests, shutdown). */
  flush(): Promise<void>;
}

export function createMailOutbox(
  transport: MailTransport,
  log: (line: string) => void,
): MailOutbox {
  const pending = new Set<Promise<void>>();
  const report = (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    const code = (e as {code?: unknown}).code;
    log(
      `No se ha podido enviar un correo de la cuenta: ${e.name}${typeof code === 'string' ? ` [${code}]` : ''}`,
    );
  };
  const track = (p: Promise<void>) => {
    const tracked = p.finally(() => pending.delete(tracked));
    pending.add(tracked);
  };
  return {
    configured: transport.configured,
    queue(message) {
      track(transport.send(message).catch(report));
    },
    defer(work) {
      // A macrotask later: the response is on its way before the work starts.
      track(
        new Promise<void>(resolve => setImmediate(resolve))
          .then(work)
          .then(message => (message ? transport.send(message) : undefined))
          .catch(err => {
            const e = err instanceof Error ? err : new Error(String(err));
            log(`No se ha podido preparar un correo de la cuenta: ${e.name}`);
          }),
      );
    },
    async send(message) {
      try {
        await transport.send(message);
      } catch (err) {
        report(err);
        throw err;
      }
    },
    async flush() {
      await Promise.all([...pending]);
    },
  };
}
