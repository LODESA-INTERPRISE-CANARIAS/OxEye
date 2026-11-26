/**
 * Placeholder for spaces that arrive in later deliveries. Says what the space
 * will do, so the navigation already explains the product.
 */
import React from 'react';
import type {Space} from '../shell/spaces';
import {SPACE_TITLE} from '../shell/spaces';
import {Button, Card, Icon, type IconName} from '../ui';

const COPY: Record<Exclude<Space, 'hoy'>, {icon: IconName; lines: string[]}> = {
  calendario: {
    icon: 'calendar',
    lines: [
      'Vista de mes y de día, con una columna por lugar y franjas horarias.',
      'Tareas de montaje, actividad, desmontaje y transporte, con la empresa asignada.',
      'Aviso cuando dos actividades coinciden en el mismo lugar o con el mismo recurso.',
    ],
  },
  inventarios: {
    icon: 'inventory',
    lines: [
      'Almacenes con su ubicación y los materiales que guardan.',
      'Cantidades, medidas, estado y disponibilidad, aunque solo se sepa una parte.',
      'Recursos propios separados de los servicios contratados.',
    ],
  },
  contactos: {
    icon: 'contacts',
    lines: [
      'Personas y empresas con cargo, teléfono, correo y notas.',
      'Llamar, escribir por WhatsApp o enviar un correo tras confirmar.',
      'Compartir una ficha de contacto solo con los datos que elijas.',
    ],
  },
  catalogo: {
    icon: 'catalog',
    lines: [
      'Ofertas de proveedores con precio, unidad y condiciones.',
      'Costes de transporte, montaje y mantenimiento por separado.',
      'Búsqueda rápida con sugerencias y tus cinco búsquedas recientes.',
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
  space: Exclude<Space, 'hoy'>;
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
