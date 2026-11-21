/**
 * OxEye (Ojo de Buey) — Live Event Planner & Multi-Agent Simulator
 * Barrel exports for TypeDoc documentation and external consumers.
 *
 * @packageDocumentation
 */

export * from './types';
export type {VehiclePose} from './types';
export * from './data/catalog';
export * from './data/geodata';
export * from './data/site-reference';
export * from './data/venue-maps';
export * from './data/plain-language-fields';
export * from './db/schema';
export * from './db/repository';
export * from './engine/cartography/custom-map';
export * from './engine/cartography/geometry';
export {gateMode} from './engine/cartography/geometry';
export * from './engine/cartography/minimap';
export * from './engine/cartography/object-skin';
export * from './engine/cartography/spawns';
export * from './engine/cartography/transform';
export * from './engine/crowd/demography';
export * from './engine/crowd/event-engine';
export * from './engine/crowd/event-model';
export * from './engine/crowd/feedback';
export * from './engine/crowd/grid-flow';
export * from './engine/crowd/personas';
export * from './engine/crowd/presets';
export * from './engine/crowd/route-traces';
export * from './engine/crowd/shelter';
export * from './engine/crowd/small-example';
export * from './engine/dining/dining';
export * from './engine/dining/furniture';
export * from './engine/director/director-logic';
export * from './engine/emergency/emergency-lab';
export * from './engine/emergency/evacuation';
export * from './engine/emergency/fire-model';
export * from './engine/emergency/incident-crowd';
export * from './engine/emergency/incident-dashboard';
export * from './engine/emergency/motion';
export * from './engine/emergency/priority';
export * from './engine/emergency/response-example';
export * from './engine/emergency/response-model';
export * from './engine/emergency/risk';
export * from './engine/emergency/risk-guidance';
export * from './engine/emergency/watch';
export * from './engine/experience/experience-monitor';
export * from './engine/experience/post-sim-diagnostics';
export * from './engine/experience/review-memory';
export * from './engine/logistics/companies';
export * from './engine/logistics/phases';
export * from './engine/logistics/shift';
export * from './engine/planning/batch';
export * from './engine/planning/contacts';
export * from './engine/planning/demand';
export * from './engine/planning/evaluator';
export * from './engine/planning/inventory';
export * from './engine/planning/layout';
export * from './engine/planning/programme';
export * from './engine/subsoil/heat';
export type {
  ClipboardEntry,
  ClipboardPayload,
  CollectionKey,
} from './components/map/selectionActions';
export * from './store/useProjectStore';
