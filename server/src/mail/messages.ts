/**
 * Texts of the account e-mails: plain Spanish, plain text, signed «Ox Eye».
 * They carry a link, never a password, and say what to do if the message
 * was not expected.
 */
import {
  EMAIL_LINK_HOURS,
  RESET_LINK_MINUTES,
} from '../../../shared/logistics/account.ts';
import type {MailMessage} from './transport.ts';

const SIGNATURE =
  '\n—\nOx Eye · Gestor logístico\nEste mensaje se ha enviado automáticamente; no hace falta responder.';

/** Reset link to the account's own verified address. */
export function resetMessage(
  to: string,
  displayName: string,
  url: string,
): MailMessage {
  return {
    to,
    subject: 'Ox Eye · Restablecer tu contraseña',
    text: [
      `Hola, ${displayName}:`,
      '',
      'Alguien ha pedido restablecer la contraseña de tu cuenta del Gestor logístico de Ox Eye.',
      `Si has sido tú, abre este enlace en los próximos ${RESET_LINK_MINUTES} minutos y elige una contraseña nueva:`,
      '',
      url,
      '',
      'El enlace solo funciona una vez. Si no lo has pedido tú, ignora este mensaje: tu contraseña no cambia.',
      SIGNATURE,
    ].join('\n'),
  };
}

/**
 * Reset link of an account without a verified address, sent to the project
 * inbox: the developer passes it on in person.
 */
export function fallbackResetMessage(
  to: string,
  username: string,
  url: string,
): MailMessage {
  return {
    to,
    subject: `Ox Eye · Enlace para restablecer la contraseña de «${username}»`,
    text: [
      `Se ha pedido restablecer la contraseña del usuario «${username}», que no tiene un correo de recuperación verificado.`,
      '',
      `Comprueba que la petición es de esa persona y hazle llegar este enlace (válido ${RESET_LINK_MINUTES} minutos, un solo uso):`,
      '',
      url,
      '',
      'Si nadie lo ha pedido, no hagas nada: la contraseña no cambia.',
      SIGNATURE,
    ].join('\n'),
  };
}

export function verifyMessage(
  to: string,
  displayName: string,
  url: string,
): MailMessage {
  return {
    to,
    subject: 'Ox Eye · Confirma tu correo de recuperación',
    text: [
      `Hola, ${displayName}:`,
      '',
      'Has indicado esta dirección para recuperar tu contraseña del Gestor logístico de Ox Eye.',
      `Para confirmarla, abre este enlace en las próximas ${EMAIL_LINK_HOURS} horas:`,
      '',
      url,
      '',
      'Si no has sido tú, ignora este mensaje: la dirección no se guardará.',
      SIGNATURE,
    ].join('\n'),
  };
}
