/**
 * Placeholder for spaces that arrive in later deliveries. Says what the space
 * will do, so the navigation already explains the product.
 */
import React from 'react';
import type {Space} from '../shell/spaces';
import {SPACE_TITLE} from '../shell/spaces';
import {Button, Card, Icon, type IconName} from '../ui';

/** Spaces still to come (the built ones have their own screens). */
export type PendingSpace = Exclude<
  Space,
  'hoy' | 'calendario' | 'contactos' | 'catalogo'
>;

const COPY: Record<PendingSpace, {icon: IconName; lines: string[]}> = {
  inventarios: {
    icon: 'inventory',
    lines: [
      'Almacenes con su ubicación y los materiales que guardan.',
      'Cantidades, medidas, estado y disponibilidad, aunque solo se sepa una parte.',
      'Recursos propios separados de los servicios contratados.',
    ],
  },
  cierre: {
    icon: 'dayClose',
    lines: [
      'Resumen del día: eventos creados o cambiados, contactos y empresas nuevas.',
      'Porcentaje de información pendiente, incidencias y decisiones.',
      'Exportable en PDF para compartirlo con el equipo.',
    ],
  },
};

export const PlaceholderScreen: React.FC<{
  space: PendingSpace;
  onGoToday: () => void;
}> = ({space, onGoToday}) => {
  const copy = COPY[space];
  return (
    <div className="lx-placeholder" id={`lx-space-${space}`}>
      <Card tone="accent" className="lx-placeholder__card">
        <span className="lx-placeholder__icon" aria-hidden="true">
          <Icon name={copy.icon} size={30} />
        </span>
        <p className="lx-eyebrow">Llega en la próxima entrega</p>
        <h2 className="lx-placeholder__title">{SPACE_TITLE[space]}</h2>
        <p className="lx-placeholder__lead">Lo que podrás hacer aquí:</p>
        <ul className="lx-placeholder__list">
          {copy.lines.map(line => (
            <li key={line}>
              <Icon name="check" size={16} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <Button variant="secondary" icon="today" onClick={onGoToday}>
          Ir a Hoy
        </Button>
      </Card>
    </div>
  );
};
