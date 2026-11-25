/**
 * @module engine/emergency/watch
 * Patrullas de vigilancia a pie, puestos fijos de vigilancia ("campeo" de zona/vallas/accesos)
 * y detección/aviso de incidentes por testigos.
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
        const hx = (r.x * e.g.m.widthMeters) / 100;
        const hy = (r.y * e.g.m.heightMeters) / 100;
        const rawCell = e.g.index(hx, hy);
        const staffFree = e.g.staffFree || e.g.free;
        const cell =
          rawCell >= 0 && staffFree[rawCell]
            ? rawCell
            : e.g.nearest(hx, hy, 10);
        if (cell < 0) return null;
        const p = e.g.point(cell);
        const fixed = !!r.fixedPost || r.patrolMode === 'fixed';
        const radius = Math.max(5, Math.min(100, Number(r.patrolRadius) || 18));
        return {
          resourceId: r.id,
          id: 'watch-' + i,
          x: p[0],
          y: p[1],
          home: [p[0], p[1]],
          homeCell: cell,
          fixed,
          radius,
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
        (r) => r.resourceId === p.resourceId && r.status !== 'resolved',
      );
      if (busy) {
        e.remove(p);
        continue;
      }
      if (p.fixed) {
        // Posición fija (vigilancia de zona / acceso / vallas): regresa a su puesto tras intervenir y mantiene guardia
        const distHome = Math.hypot(p.x - p.home[0], p.y - p.home[1]);
        if (distHome > 1.2) {
          if (p.target !== p.homeCell) {
            p.target = p.homeCell;
            p.field = e.getFlow(p.homeCell);
          }
          if (!e.move(p, p.field, p.homeCell, dt, 0.5)) {
            const step = Math.min(distHome, p.speed * dt);
            p.x += ((p.home[0] - p.x) / distHome) * step;
            p.y += ((p.home[1] - p.y) / distHome) * step;
          }
        } else {
          p.target = null;
        }
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
      const rx = row.point[0];
      const ry = row.point[1];
      const people: Array<Record<string, unknown>> = [];
      for (let i = 0; i < e.agents.length; i++) {
        const a = e.agents[i];
        if (a.state === 'gone') continue;
        if (Math.abs(a.x - rx) > 18 || Math.abs(a.y - ry) > 18) continue;
        const prof = e.emergency?.social?.profile(a);
        const rad = prof?.radius ?? 12;
        const delay = prof?.delay ?? 0;
        if (
          e.time - row.created >= delay &&
          Math.hypot(a.x - rx, a.y - ry) <= rad
        ) {
          people.push(a);
          if (people.length >= 6) break;
        }
      }
      const agents = this.patrols.filter(
        (p) => Math.hypot(p.x - rx, p.y - ry) <= Math.max(16, p.fixed ? p.radius || 18 : 16),
      );
      row.reporters = people.map((a: any) => ({
        id: a.id,
        label: a.persona?.personName || 'Visitante ' + a.id,
        role: a.id === row.agentId ? 'Persona afectada' : 'Testigo',
      }));
      for (const a of agents) {
        row.reporters.push({
          id: a.id,
          label: a.fixed ? 'Policía en puesto fijo' : 'Patrulla a pie',
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
        (p) =>
          !events.some(
            (r) => r.resourceId === p.resourceId && r.status !== 'resolved',
          ),
      )
      .map(
        (p) =>
          '<g><circle cx="' +
          p.x +
          '" cy="' +
          p.y +
          '" r=".48" fill="#244ea0" stroke="#fff" stroke-width=".14"/><text x="' +
          p.x +
          '" y="' +
          (p.y - 1) +
          '" font-size="1.3" fill="#234b89">' +
          (p.fixed ? 'POL · fijo' : 'POL · patrulla') +
          '</text></g>',
      )
      .join('');
  }
}
