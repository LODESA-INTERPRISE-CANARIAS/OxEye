/**
 * What the user sees before the server is usable: connecting, not configured
 * or not reachable. Each state says in plain words what is happening and what
 * to do next.
 */
import React, {useEffect, useState} from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Spinner} from '../ui';
import {GateLayout} from './GateLayout';

const LOCAL_STEPS = [
  {
    text: 'Arranca la base de datos',
    command: 'docker compose -f server/docker-compose.yml up -d',
  },
  {text: 'Arranca el servidor', command: 'npm --prefix server run dev'},
  {text: 'Vuelve aquí y pulsa «Reintentar».', command: null},
];

const LocalHelp: React.FC = () => (
  <details className="lx-disclosure" id="lx-local-help">
    <summary>¿Trabajas en local? Así se arranca</summary>
    <ol className="lx-steps">
      {LOCAL_STEPS.map(step => (
        <li key={step.text}>
          <span>{step.text}</span>
          {step.command && <code>{step.command}</code>}
        </li>
      ))}
    </ol>
    <p className="lx-muted">
      El servidor escucha en el puerto 8787. Desde el móvil, usa la dirección
      del ordenador en la misma red wifi.
    </p>
  </details>
);

export const ServerGate: React.FC<{onExit: () => void}> = ({onExit}) => {
  const phase = useLogisticsStore(s => s.phase);
  const reason = useLogisticsStore(s => s.unreachableReason);
  const connection = useLogisticsStore(s => s.connection);
  const boot = useLogisticsStore(s => s.boot);
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await boot();
    } finally {
      setRetrying(false);
    }
  };

  // Try again on its own when the device regains connection.
  useEffect(() => {
    if (phase !== 'unreachable') return;
    const onOnline = () => void boot();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [phase, boot]);

  if (phase === 'checking' || phase === 'restoring') {
    return (
      <GateLayout onExit={onExit} id="lx-gate-checking">
        <div className="lx-gate__status" aria-live="polite">
          <Spinner label="Conectando" />
          <h1 className="lx-gate__title">
            {phase === 'restoring' ? 'Recuperando tu sesión…' : 'Conectando…'}
          </h1>
          <p className="lx-gate__lead">
            Comprobando que el servidor del Gestor logístico responde.
          </p>
        </div>
      </GateLayout>
    );
  }

  if (phase === 'not_configured') {
    return (
      <GateLayout onExit={onExit} id="lx-gate-not-configured">
        <span className="lx-gate__icon" aria-hidden="true">
          <Icon name="server" size={28} />
        </span>
        <h1 className="lx-gate__title">Falta conectar el servidor</h1>
        <p className="lx-gate__lead">
          Esta copia de Ox Eye no sabe dónde está el servidor del Gestor
          logístico, así que no puede guardar ni mostrar datos.
        </p>
        <p className="lx-muted">
          Quien publica la web debe indicar la dirección del servidor en la
          variable <code>VITE_LOGISTICS_API_URL</code> al construirla. El
          simulador sigue funcionando con normalidad.
        </p>
        <div className="lx-gate__actions">
          <Button variant="primary" size="lg" icon="back" onClick={onExit}>
            Volver a Ox Eye
          </Button>
        </div>
      </GateLayout>
    );
  }

  const offline = connection === 'offline';
  const title = offline
    ? 'Sin conexión'
    : reason === 'database'
      ? 'La base de datos no responde'
      : 'Servidor no disponible';
  const lead = offline
    ? 'Este dispositivo no tiene conexión. En cuanto vuelva, lo intentaremos de nuevo automáticamente.'
    : reason === 'database'
      ? 'El servidor responde, pero no puede leer su base de datos. Hasta que vuelva no se puede consultar ni guardar nada.'
      : 'No hemos podido contactar con el servidor del Gestor logístico. Puede estar apagado o la red puede estar cortando la conexión.';

  return (
    <GateLayout onExit={onExit} id="lx-gate-unreachable">
      <span className="lx-gate__icon lx-gate__icon--warn" aria-hidden="true">
        <Icon name="cloudOff" size={28} />
      </span>
      <h1 className="lx-gate__title" id="lx-gate-title">
        {title}
      </h1>
      <p className="lx-gate__lead" role="status">
        {lead}
      </p>
      <div className="lx-gate__actions">
        <Button
          variant="primary"
          size="lg"
          icon="refresh"
          id="lx-retry"
          busy={retrying}
          onClick={() => void retry()}
        >
          {retrying ? 'Reintentando…' : 'Reintentar'}
        </Button>
      </div>
      {!offline && <LocalHelp />}
    </GateLayout>
  );
};
