/**
 * @module engine/emergency/incident-crowd
 * Social reaction of nearby crowd agents (curiosity, avoidance, police dispersal, and perceptual delay) around active emergencies.
 */
import type {Agent, EmergencyIncident, Point} from '../../types';

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export class IncidentCrowd {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any;
  next: number;
  stats: {curious: number; avoid: number; dispersed: number; unable: number};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(e: any) {
    this.e = e;
    this.next = 0;
    this.stats = {curious: 0, avoid: 0, dispersed: 0, unable: 0};
  }

  profile(a: Agent): {
    mild: boolean;
    sensory: boolean;
    delay: number;
    radius: number;
    curiosity: number;
  } {
    if (a.incidentProfile) return a.incidentProfile;
    const random = this.e.emergency.random;
    const adult = (a.persona?.age ?? 18) >= 18;
    const mild =
      adult && random() < (this.e.s.mildAlcoholShare ?? 5) / 100;
    const sensory = random() < (this.e.s.sensoryShare ?? 10) / 100;
    const age = a.persona?.age ?? 35;
    const delay =
      2 +
      random() * 6 +
      (age < 12 ? 2 : age > 75 ? 2 : 0) +
      (mild ? 5 : 0) +
      (sensory ? 5 : 0);
    a.incidentProfile = {
      mild,
      sensory,
      delay,
      radius: sensory ? 9 : 16,
      curiosity: random(),
    };
    return a.incidentProfile;
  }

  destination(
    a: Agent,
    row: EmergencyIncident,
    mode: 'curious' | 'avoid'
  ): {cell: number; field: Int32Array} | null {
    const e = this.e;
    if (!row.point) return null;
    const origin = e.g.index(a.x, a.y);
    const r =
      mode === 'curious'
        ? (e.s.incidentRadius ?? 8) + 3
        : (e.s.incidentRadius ?? 8) + 12;
    const angle = Math.atan2(a.y - row.point[1], a.x - row.point[0]);
    for (const turn of [0, 0.5, -0.5, 1, -1, 2, -2, 3]) {
      const x = row.point[0] + Math.cos(angle + turn) * r;
      const y = row.point[1] + Math.sin(angle + turn) * r;
      const k = e.g.nearest(x, y, 4);
      if (k < 0 || !e.clearAt(...e.g.point(k), a.id)) continue;
      const field = e.getFlow(k);
      if (origin >= 0 && field[origin] >= 0) return {cell: k, field};
    }
    return null;
  }

  update(): void {
    const e = this.e;
    if (e.time < this.next) return;
    this.next = e.time + 2;
    const active = (e.emergency.events as EmergencyIncident[]).filter(
      (r) => r.status !== 'resolved' && r.point
    );
    for (const a of e.agents as Agent[]) {
      if (!['roam', 'walk', 'mealSearch'].includes(a.state || '')) continue;
      const profile = this.profile(a);
      const row = active.find(
        (r) =>
          r.agentId !== a.id &&
          r.point &&
          distance([a.x, a.y], r.point) < profile.radius
      );
      if (!row || !row.point) {
        if (a.incidentReaction) {
          delete a.incidentReaction;
          a.socialCooldown = e.time + 60;
        }
        continue;
      }
      const police =
        e.emergency.watch.patrols.some(
          (p: {x: number; y: number}) =>
            distance([p.x, p.y], row.point!) < 16
        ) ||
        (e.emergency.events as EmergencyIncident[]).some(
          (r) =>
            ['security', 'patrol'].includes(r.responseMode || '') &&
            r.vehiclePose &&
            r.status !== 'resolved' &&
            distance([r.vehiclePose.x, r.vehiclePose.y], row.point!) < 16
        );
      const prior = a.incidentReaction;
      if (prior && prior.event === row.id) {
        if (police && prior.mode === 'curious' && !prior.ordered) {
          prior.mode = 'disperse';
          prior.ordered = true;
          prior.reactAt = e.time + profile.delay;
          prior.until = e.time + profile.delay + 45;
          prior.destination = this.destination(a, row, 'avoid');
          this.stats.dispersed++;
          if (!prior.destination) this.stats.unable++;
        }
        if (e.time > prior.until) {
          delete a.incidentReaction;
          a.socialCooldown = e.time + 90;
        }
        continue;
      }
      if (e.time < (a.socialCooldown || 0)) continue;
      const curious =
        profile.curiosity < (e.s.curiosityShare ?? 20) / 100 && !police;
      const mode = curious ? 'curious' : 'avoid';
      const target = this.destination(a, row, mode);
      a.incidentReaction = {
        event: row.id,
        mode,
        reactAt: e.time + profile.delay,
        until: e.time + profile.delay + 40,
        destination: target,
      };
      this.stats[curious ? 'curious' : 'avoid']++;
      if (!target) this.stats.unable++;
    }
  }

  step(a: Agent, dt: number): boolean {
    const reaction = a.incidentReaction;
    if (!reaction || !['roam', 'walk', 'mealSearch'].includes(a.state || '')) {
      return false;
    }
    if (this.e.time < reaction.reactAt) return false;
    if (reaction.destination) {
      this.e.move(
        a,
        reaction.destination.field,
        reaction.destination.cell,
        dt,
        0.8
      );
    }
    return true;
  }
}
