/**
 * Promotion review of a layout (OX-04 plan D9): runs the risk assessment with
 * route checks (routes A/B/C, gates, X-ray / heavy load, perimeter) on the
 * composed scene of one layout and applies the promotion gate. Nothing is
 * inherited from another layout (plan D11).
 */
import type {Scene} from '../../types';
import {EventEngine} from '../crowd/event-engine';
import {ResponseSimulation} from '../emergency/response-model';
import {assessRisk, type RiskAssessmentReport} from '../emergency/risk';
import {ExperienceMonitor} from '../experience/experience-monitor';
import {phaseScene} from '../logistics/phases';
import {evaluatePromotionGate, type GateResult} from './venue-layout';

export interface LayoutReview {
  report: RiskAssessmentReport;
  gate: GateResult;
}

export function reviewLayoutScene(scene: Scene): LayoutReview {
  let report: RiskAssessmentReport;
  try {
    const engine = new EventEngine(phaseScene(scene, 'event'));
    engine.emergency = new ResponseSimulation(engine);
    engine.experience = new ExperienceMonitor(engine);
    report = assessRisk(scene, engine, {routes: true});
  } catch {
    // Without a runnable engine the route checks cannot be confirmed: report
    // the static assessment plus an explicit medical-route blocker.
    report = assessRisk(scene);
    report.issues.push({
      id: 'route-unverified',
      level: 'critical',
      title: 'No se han podido comprobar las rutas de emergencia A/B/C',
      action: 'Revisa accesos y recorridos del recinto y vuelve a intentarlo.',
    });
  }
  return {report, gate: evaluatePromotionGate(report.issues)};
}
