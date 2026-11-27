/**
 * Pieces shared by the Inventarios space, the resource and warehouse sheets
 * and the task form: the quantity in the certainty grammar, condition and
 * availability chips, and a resource row.
 *
 * Quantity, unit and dimensions are shown as recorded and never combined:
 * they are inventory data, not a load on the ground (RESOURCE_LOAD_NOTE).
 */
import React from 'react';
import {RESOURCE_LOAD_NOTE} from '../../../shared/logistics/conflicts.ts';
import type {Resource} from '../../../shared/logistics/contracts.ts';
import {quantityLabel} from '../../../shared/logistics/inventory.ts';
import {missingForResource} from '../../../shared/logistics/quality.ts';
import {
  RESOURCE_AVAILABILITY_LABEL,
  RESOURCE_CONDITION_LABEL,
} from '../../../shared/logistics/rules.ts';
import {
  availabilityTone,
  conditionTone,
  quantityCertainty,
} from '../lib/inventory';
import {plural} from '../lib/format';
import {UnsentMark} from '../offline/PendingMark';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Chip, CERTAINTY_HELP, HelpTip, Icon} from '../ui';
import {PhotoThumb} from './PhotoThumb';

/** Help next to quantity, unit and dimensions, in forms and sheets. */
export const LoadNoteTip: React.FC<{label?: string}> = ({
  label = 'cantidad y medidas',
}) => <HelpTip label={label}>{RESOURCE_LOAD_NOTE}</HelpTip>;

/** Units that record a weight: the moment someone may be tempted to compute a load. */
const WEIGHT_UNITS = new Set(['kg', 'kgs', 'kilos', 't', 'tn', 'toneladas']);
/** Built-in resource categories of material that is usually heavy. */
const HEAVY_CATEGORIES = new Set([
  'Escenarios y tarimas',
  'Generadores y electricidad',
]);

/**
 * RESOURCE_LOAD_NOTE in plain sight (not behind `?`) while the form records a
 * weight or a usually heavy category: the subsoil question belongs to the
 * task's «Carga pesada» and the simulator's X-ray check.
 */
export const LoadNoteInline: React.FC<{
  unit: string;
  categoryId: string | null;
}> = ({unit, categoryId}) => {
  const categoryName = useLogisticsStore(s =>
    categoryId ? s.categories.find(c => c.id === categoryId)?.name : undefined,
  );
  const weight = WEIGHT_UNITS.has(unit.trim().toLowerCase().replace(/\.$/, ''));
  if (!weight && !(categoryName && HEAVY_CATEGORIES.has(categoryName))) {
    return null;
  }
  return (
    <p
      className="lx-notice lx-notice--quiet"
      role="note"
      id="lx-resource-load-note"
    >
      <Icon name="weight" size={16} />
      {RESOURCE_LOAD_NOTE}
    </p>
  );
};

/**
 * «200 unidades» solid when validated, outlined when not, dashed «≈ 40 ·
 * por evaluar», dotted «Sin contar».
 */
export const QuantityChip: React.FC<{
  resource: Pick<Resource, 'quantity' | 'unit' | 'toAssess' | 'verification'>;
  size?: 'sm' | 'md';
}> = ({resource, size = 'sm'}) => {
  const certainty = quantityCertainty(resource);
  return (
    <Chip
      certainty={certainty}
      tone={certainty === 'pending' ? 'neutral' : 'accent'}
      size={size}
      className="lx-qtychip lx-num"
      title={CERTAINTY_HELP[certainty]}
    >
      {quantityLabel(resource)}
    </Chip>
  );
};

export const ConditionChip: React.FC<{
  condition: Resource['condition'];
  size?: 'sm' | 'md';
}> = ({condition, size = 'sm'}) => {
  const tone = conditionTone(condition);
  return (
    <Chip
      size={size}
      certainty={tone === 'pending' ? 'pending' : 'planned'}
      tone={tone === 'danger' ? 'danger' : 'neutral'}
      className="lx-statechip"
    >
      {RESOURCE_CONDITION_LABEL[condition]}
    </Chip>
  );
};

export const AvailabilityChip: React.FC<{
  availability: Resource['availability'];
  size?: 'sm' | 'md';
}> = ({availability, size = 'sm'}) => {
  const tone = availabilityTone(availability);
  return (
    <Chip
      size={size}
      certainty={tone === 'pending' ? 'pending' : 'planned'}
      tone={tone === 'pending' ? 'neutral' : tone}
      className="lx-statechip"
    >
      {RESOURCE_AVAILABILITY_LABEL[availability]}
    </Chip>
  );
};

/**
 * A resource in a list: its main photo (or category icon), name, category,
 * quantity, state and what is missing.
 */
export const ResourceRow: React.FC<{
  resource: Resource;
  category?: string | null;
  /** Context under the name (offer, location…), never free text. */
  context?: string | null;
  onOpen: (resource: Resource) => void;
}> = ({resource: r, category, context, onOpen}) => {
  const missing = missingForResource(r);
  const sub = [category, context].filter(Boolean).join(' · ');
  return (
    <li className="lx-resrow" data-resource-id={r.id}>
      <button
        type="button"
        className="lx-resrow__main"
        onClick={() => onOpen(r)}
      >
        <PhotoThumb resource={r} categoryName={category} />
        <span className="lx-resrow__text">
          <span className="lx-resrow__name">
            {r.name}
            {r.isDemo && <span className="lx-dirrow__demo">Demo</span>}
          </span>
          {sub && <span className="lx-resrow__sub">{sub}</span>}
          <span className="lx-resrow__chips">
            <UnsentMark id={r.id} />
            <ConditionChip condition={r.condition} />
            <AvailabilityChip availability={r.availability} />
            {r.taskIds.length > 0 && (
              <span className="lx-resrow__tasks lx-num">
                <Icon name="task" size={14} />
                {plural(r.taskIds.length, 'tarea', 'tareas')}
              </span>
            )}
          </span>
          {missing.length > 0 && (
            <span className="lx-dirrow__missing">
              <span className="lx-chip__dot" aria-hidden="true" />
              Falta {missing.join(', ')}
            </span>
          )}
        </span>
        <span className="lx-resrow__qty">
          <QuantityChip resource={r} />
        </span>
        <Icon name="chevronRight" size={18} className="lx-dirrow__chev" />
      </button>
    </li>
  );
};
