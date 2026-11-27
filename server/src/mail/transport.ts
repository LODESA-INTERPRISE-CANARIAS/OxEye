/**
 * Account e-mails (Revisión 1 · E4): password-reset and verification links,
 * never a password. One interface, two transports:
 * - SMTP (nodemailer) when `SMTP_HOST` is set;
 * - console otherwise: nothing is sent. Only with NODE_ENV=development set
 *   explicitly is the message (with its link) written to the server log so
 *   a developer can follow it; otherwise only «correo pendiente para
 *   y•••@example.com» is logged.
 *
 * Addresses are never logged in clear and never returned by the API.
 */
import {createTransport} from 'nodemailer';
import type {MailConfig} from '../config.ts';
import {maskEmail} from '../../../shared/logistics/account.ts';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text, Spanish, signed «OxEye». */
  text: string;
}

export interface MailTransport {
  /** True when messages really leave the server (SMTP). */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/**
 * No sending. With `printLinks` (NODE_ENV=development set explicitly) the
 * whole message is logged; otherwise only the masked address, never a link.
 */
export function createConsoleTransport(
  printLinks: boolean,
  log: (line: string) => void,
): MailTransport {
  return {
    configured: false,
    async send(message) {
      if (printLinks) {
        log(
          `Correo (sin enviar, falta SMTP) para ${maskEmail(message.to)} · ${message.subject}\n${message.text}`,
        );
      } else {
        log(
          `Correo pendiente para ${maskEmail(message.to)} (SMTP sin configurar)`,
        );
      }
    },
  };
}

/** Keeps the messages in memory (tests). */
export function createMemoryTransport(configured = false): MailTransport & {
  sent: MailMessage[];
} {
  const sent: MailMessage[] = [];
  return {
    configured,
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

export function createSmtpTransport(mail: MailConfig): MailTransport {
  const smtp = mail.smtp;
  if (!smtp || !mail.from) throw new Error('SMTP is not configured');
  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: smtp.user ? {user: smtp.user, pass: smtp.pass ?? ''} : undefined,
  });
  const from = mail.from;
  return {
    configured: true,
    async send(message) {
      await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/** The transport for this configuration. */
export function createMailTransport(
  mail: MailConfig,
  log: (line: string) => void,
): MailTransport {
  return mail.smtp
    ? createSmtpTransport(mail)
    : createConsoleTransport(mail.printLinks, log);
}
