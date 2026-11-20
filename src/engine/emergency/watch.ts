/**
 * @module engine/emergency/watch
 * Patrullas de vigilancia a pie y detección/aviso de incidentes por testigos.
 */

export class Watch {
  e: any;
  nextScan: number;
  patrols: Array<Record<string, any>>;

  constructor(e: any) {
    this.e = e;
    this.nextScan = 0;
    this.patrols = e.s.infrastructure
      .filter(
        (o: any) =>
          o.role === 'emergency' &&
          o.kind === 'security' &&
          o.active !== false &&
          (o.staff || 0) > 0,
      )
      .map((r: any, i: number) => {
        const cell = e.g.nearest(
          (r.x * e.g.m.widthMeters) / 100,
          (r.y * e.g.m.heightMeters) / 100,
          8,
        );
        if (cell < 0) return null;
        const p = e.g.point(cell);
        return {
          resourceId: r.id,
          id: 'watch-' + i,
          x: p[0],
          y: p[1],
          r: 0.3,
          speed: 0.9,
          stuck: 0,
          target: null,
        };
      })
      .filter(Boolean);
  }

  update(dt: number, events: Array<Record<string, any>>) {
    const e = this.e;
    for (const p of this.patrols) {
      const busy = events.some(
        r => r.resourceId === p.resourceId && r.status !== 'resolved',
      );
      if (busy) {
        e.remove(p);
        continue;
      }
      if (p.target === null || p.stuck > 20) {
        let target: number | null = null;
        for (let i = 0; i < 20; i++) {
          const k =
            e.waypoints[Math.floor(e.emergency.random() * e.waypoints.length)];
          if (k == null) continue;
          const field = e.getFlow(k);
          const here = e.g.index(p.x, p.y);
          if (here >= 0 && field[here] >= 0) {
            target = k;
            p.field = field;
            break;
          }
        }
        p.target = target;
        p.stuck = 0;
      }
      if (p.target !== null && e.move(p, p.field, p.target, dt, 0.6)) {
        p.target = null;
      }
    }
    if (e.time < this.nextScan) return;
    this.nextScan = e.time + 2;
    for (const row of events) {
      if (row.reportedAt != null || row.status === 'resolved') continue;
      const people = e.agents.filter(
        (a: any) =>
          a.state !== 'gone' &&
          Math.hypot(a.x - row.point[0], a.y - row.point[1]) <=
            (e.emergency?.social?.profile(a).radius ?? 12) &&
          e.time - row.created >= (e.emergency?.social?.profile(a).delay ?? 0),
      );
      const agents = this.patrols.filter(
        p => Math.hypot(p.x - row.point[0], p.y - row.point[1]) <= 16,
      );
      row.reporters = people.slice(0, 6).map((a: any) => ({
        id: a.id,
        label: a.persona?.personName || 'Visitante ' + a.id,
        role: a.id === row.agentId ? 'Persona afectada' : 'Testigo',
      }));
      for (const a of agents) {
        row.reporters.push({
          id: a.id,
          label: 'Patrulla a pie',
          role: 'Observación directa',
        });
      }
      if (row.stationId) {
        row.reporters.push({
          id: row.stationId,
          label: 'Responsable del puesto',
          role: 'Personal del puesto',
        });
      }
      if (row.reporters.length) {
        row.reportedAt = e.time;
        row.reportDelay = e.time - row.created;
        row.status = row.afterReportStatus || 'pending';
        row.note =
          'Aviso recibido de ' +
          row.reporters.length +
          ' personas o equipos. ' +
          (row.note || '');
      }
    }
  }

  svg(events: Array<Record<string, any>>): string {
    return this.patrols
      .filter(
        p =>
          !events.some(
            r => r.resourceId === p.resourceId && r.status !== 'resolved',
          ),
      )
      .map(
        p =>
          '<g><circle cx="' +
          p.x +
          '" cy="' +
          p.y +
          '" r=".48" fill="#244ea0" stroke="#fff" stroke-width=".14"/><text x="' +
          p.x +
          '" y="' +
          (p.y - 1) +
          '" font-size="1.3" fill="#234b89">POL · patrulla</text></g>',
      )
      .join('');
  }
}
