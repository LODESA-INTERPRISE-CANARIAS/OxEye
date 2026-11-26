/**
 * Notice shown while fictitious demo records exist, with a confirmed action
 * to remove them (members only).
 */
import React, {useState} from 'react';
import {errorMessage} from '../api/client';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Sheet} from '../ui';

/** Demo records left, by kind. */
export interface DemoCounts {
  events: number;
  tasks: number;
  contacts: number;
  companies: number;
  offers: number;
  warehouses: number;
  resources: number;
  notes: number;
}

const KIND_WORDS: Record<keyof DemoCounts, [string, string]> = {
  events: ['evento', 'eventos'],
  tasks: ['tarea', 'tareas'],
  contacts: ['persona', 'personas'],
  companies: ['empresa o entidad', 'empresas o entidades'],
  offers: ['oferta', 'ofertas'],
  warehouses: ['almacén', 'almacenes'],
  resources: ['recurso', 'recursos'],
  notes: ['nota', 'notas'],
};

/** «2 eventos, 3 personas y 5 ofertas». */
function breakdown(counts: DemoCounts): string {
  const parts = (Object.keys(KIND_WORDS) as (keyof DemoCounts)[])
    .filter(k => counts[k] > 0)
    .map(k => `${counts[k]} ${KIND_WORDS[k][counts[k] === 1 ? 0 : 1]}`);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
    : (parts[0] ?? '');
}

export const DemoNotice: React.FC<{counts: DemoCounts; canWrite: boolean}> = ({
  counts,
  canWrite,
}) => {
  const count = Object.values(counts).reduce((a, b) => a + b, 0);
  const removeDemo = useLogisticsStore(s => s.removeDemo);
  const toast = useLogisticsStore(s => s.toast);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const removed = await removeDemo();
      setConfirming(false);
      toast(
        removed === 1
          ? 'Se ha quitado 1 registro de demostración.'
          : `Se han quitado ${removed} registros de demostración.`,
        'success',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section
        className="lx-demo"
        id="lx-demo-notice"
        aria-labelledby="lx-demo-title"
      >
        <span className="lx-demo__icon" aria-hidden="true">
          <Icon name="flask" size={22} />
        </span>
        <div className="lx-demo__text">
          <h2 id="lx-demo-title">Hay datos de demostración</h2>
          <p>
            {count === 1
              ? `Un registro ficticio (${breakdown(counts)}), marcado «Demo», sirve para probar la aplicación.`
              : `${count} registros ficticios (${breakdown(counts)}), marcados «Demo», sirven para probar la aplicación.`}{' '}
            {canWrite
              ? 'Quítalos antes de registrar la jornada real.'
              : 'Solo el equipo puede quitarlos.'}
          </p>
        </div>
        {canWrite && (
          <Button
            variant="secondary"
            icon="trash"
            id="lx-demo-remove"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Quitar datos de demostración
          </Button>
        )}
      </section>

      <Sheet
        open={confirming}
        onClose={() => !busy && setConfirming(false)}
        title="¿Quitar los datos de demostración?"
        eyebrow="Confirmar"
        size="sm"
        role="alertdialog"
        id="lx-demo-confirm"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(false)}
              id="lx-demo-cancel"
            >
              Cancelar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="danger"
              icon="trash"
              busy={busy}
              onClick={() => void confirm()}
              id="lx-demo-confirm-button"
            >
              {busy ? 'Quitando…' : 'Quitar'}
            </Button>
          </>
        }
      >
        <p>
          Se borrarán todos los registros marcados «Demo» de esta organización.
          Los datos reales no se tocan. No se puede deshacer.
        </p>
        {error && (
          <p className="lx-notice lx-notice--error" role="alert">
            <Icon name="alert" size={16} />
            {error}
          </p>
        )}
      </Sheet>
    </>
  );
};
