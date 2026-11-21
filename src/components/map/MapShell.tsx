import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {CATALOG} from '../../data/catalog';
import {CARTO_DATA, ORTHO_IMAGES} from '../../data/geodata';
import {
  computeMapTiles,
  fetchOsmVectorContext,
} from '../../engine/cartography/custom-map';
import {
  cellAt,
  column,
  localPoint,
  percent,
  polylineLength,
  world,
} from '../../engine/cartography/geometry';
import {objectSkin} from '../../engine/cartography/object-skin';
import {
  generateCoherentSpawns,
  normalizeAccessFlows,
  snapEntranceToPerimeter,
  snapPointToPerimeter,
} from '../../engine/cartography/spawns';
import {
  transformHandles,
  transformObject,
} from '../../engine/cartography/transform';
import {
  membership,
  phaseColors,
  phaseScene,
  phases,
} from '../../engine/logistics/phases';
import {insertStock} from '../../engine/planning/inventory';
import {useProjectStore} from '../../store/useProjectStore';
import type {
  Booth,
  Infrastructure,
  PhaseKey,
  Point,
} from '../../types';
import type {ProposalState} from '../layout/Sidebar';
import {Inspector} from './Inspector';
import {LayerPanel} from './LayerPanel';
import {useMapShortcuts} from './useMapShortcuts';
import {XRayLayer} from './XRayLayer';
import {
  applyWallDrag,
  buildDraftSvg,
  commitSubsoilBoundary,
  commitSubsoilWall,
  placeSubsoilColumn,
  resolveSubsoilPointerDown,
} from './xrayTools';

export interface MapShellHandle {
  fit: () => void;
  drawBase: () => void;
  drawGrid: () => void;
  drawScenario: () => void;
}

export interface MapShellProps {
  proposal: ProposalState | null;
  showAlternative: boolean;
  onClearProposal: () => void;
  onSceneChanged: () => void;
  onUndoRedo: (isRedo?: boolean) => void;
  activeWeather: string;
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] || c
  );

const num = (n: number): string =>
  Number(n).toLocaleString('es-ES', {maximumFractionDigits: 1});

const itemColor = (o: {kind?: string; type?: string; role?: string}): string =>
  (o.kind && CATALOG[o.kind]?.color) ||
  (o.type && CATALOG[o.type]?.color) ||
  (o.role && CATALOG[o.role]?.color) ||
  '#bac7ac';

/**
 * Interactive SVG cartographic canvas (`#map` / `#drawing`) with pan/zoom, element dragging,
 * freehand polygon/polyline drawing, atmosphere overlays, and floating HUDs.
 */
export const MapShell = forwardRef<MapShellHandle, MapShellProps>(
  (
    {
      proposal,
      showAlternative,
      onClearProposal,
      onSceneChanged,
      onUndoRedo,
      activeWeather,
    },
    ref
  ) => {
    const mapDivRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const baseLayerRef = useRef<SVGGElement | null>(null);
    const gridLayerRef = useRef<SVGGElement | null>(null);
    const scenarioLayerRef = useRef<SVGGElement | null>(null);
    const annotationLayerRef = useRef<SVGGElement | null>(null);
    const draftLayerRef = useRef<SVGGElement | null>(null);
    const scaleLineRef = useRef<HTMLDivElement | null>(null);
    const scaleTextRef = useRef<HTMLSpanElement | null>(null);
    const cellSpanRef = useRef<HTMLElement | null>(null);
    const coordsSpanRef = useRef<HTMLSpanElement | null>(null);

    const viewRef = useRef({x: 0, y: 0, w: 500, h: 400});
    const boundaryModeRef = useRef<'replace' | 'add' | 'subtract'>('replace');
    const dragRef = useRef<{
      p: Point;
      client: Point;
      view: {x: number; y: number; w: number; h: number};
      id: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      o: any;
      old: Point | null;
      handle: string | null;
      xrayKind?: 'column' | 'wall' | 'polygon' | null;
      xrayHandle?: 'a' | 'b' | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshot: any;
      moved: boolean;
      checkpoint: boolean;
      panOnly?: boolean;
    } | null>(null);

    const [draftPoints, setDraftPoints] = useState<Point[]>([]);
    const [boundaryMode, setBoundaryMode] = useState<
      'replace' | 'add' | 'subtract'
    >('replace');

    const activeVenue = useProjectStore((s) => s.activeVenue);
    const panel = useProjectStore((s) => s.panel);
    const phase = useProjectStore((s) => s.phase);
    const base = useProjectStore((s) => s.base);
    const tool = useProjectStore((s) => s.tool);
    const selectedIds = useProjectStore((s) => s.selectedIds);
    const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
    const grid = useProjectStore((s) => s.grid);
    const gridVisible = useProjectStore((s) => s.gridVisible);
    const labelsVisible = useProjectStore((s) => s.labelsVisible);
    const routesVisible = useProjectStore((s) => s.routesVisible);
    const xrayVisible = useProjectStore((s) => s.xrayVisible);
    const daylight = useProjectStore((s) => s.daylight);
    const immersive = useProjectStore((s) => s.immersive);
    const history = useProjectStore((s) => s.history);
    const future = useProjectStore((s) => s.future);
    const currentScene = useProjectStore((s) => s.currentScene);
    const currentMap = useProjectStore((s) => s.currentMap);
    const revision = useProjectStore((s) => s.revision);
    const onboardingStage = useProjectStore((s) => s.onboardingStage);

    const setTool = useProjectStore((s) => s.setTool);
    const setSelectedId = useProjectStore((s) => s.setSelectedId);
    const setSelectedIds = useProjectStore((s) => s.setSelectedIds);
    const toggleSelectedId = useProjectStore((s) => s.toggleSelectedId);
    const setPanel = useProjectStore((s) => s.setPanel);
    const setActiveModal = useProjectStore((s) => s.setActiveModal);
    const setOnboardingStage = useProjectStore((s) => s.setOnboardingStage);
    const setCustomMapVectors = useProjectStore((s) => s.setCustomMapVectors);
    const toggleImmersive = useProjectStore((s) => s.toggleImmersive);
    const hydratedCustomMapRef = useRef<string | null>(null);
    const updateScene = useProjectStore((s) => s.updateScene);
    const checkpoint = useProjectStore((s) => s.checkpoint);
    const save = useProjectStore((s) => s.save);
    const showToast = useProjectStore((s) => s.showToast);

    useMapShortcuts(onSceneChanged, onUndoRedo);

    const tagsForNew = useCallback((): PhaseKey[] => {
      return phase === 'all' ? ['event'] : [phase];
    }, [phase]);

    const drawGrid = useCallback(() => {
      const m = currentMap();
      const mapEl = mapDivRef.current;
      const gridEl = gridLayerRef.current;
      if (!mapEl || !gridEl) return;
      const view = viewRef.current;
      let html = '';
      if (gridVisible) {
        const sx = Math.max(0, Math.floor(view.x / grid) * grid);
        const ex = Math.min(m.widthMeters, view.x + view.w);
        const sy = Math.max(0, Math.floor(view.y / grid) * grid);
        const ey = Math.min(m.heightMeters, view.y + view.h);
        const stroke = base === 'ortho' ? '#ffffff' : '#52684b';
        const alpha = base === 'ortho' ? 0.25 : 0.15;
        const clientW = mapEl.clientWidth || 800;
        const font = (view.w / clientW) * 9;
        for (let x = sx; x <= ex; x += grid) {
          html += `<line x1="${x}" y1="${Math.max(0, view.y)}" x2="${x}" y2="${ey}" stroke="${stroke}" stroke-opacity="${alpha}" stroke-width=".18"/><text class="grid-label" x="${x + grid / 2}" y="${Math.max(0, view.y) + font * 1.7}" font-size="${font}" text-anchor="middle">${column(Math.round(x / grid))}</text>`;
        }
        for (let y = sy; y <= ey; y += grid) {
          html += `<line x1="${Math.max(0, view.x)}" y1="${y}" x2="${ex}" y2="${y}" stroke="${stroke}" stroke-opacity="${alpha}" stroke-width=".18"/><text class="grid-label" x="${Math.max(0, view.x) + font}" y="${y + grid / 2}" font-size="${font}">${Math.round(y / grid) + 1}</text>`;
        }
      }
      gridEl.innerHTML = html;
    }, [currentMap, gridVisible, grid, base]);

    const applyView = useCallback(() => {
      const svg = svgRef.current;
      const mapEl = mapDivRef.current;
      if (!svg || !mapEl) return;
      const view = viewRef.current;
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
      drawGrid();
      const clientW = mapEl.clientWidth || 800;
      const ppm = clientW / view.w;
      const meters = ppm > 6 ? 10 : ppm > 2 ? 20 : 50;
      if (scaleLineRef.current) {
        scaleLineRef.current.style.width = meters * ppm + 'px';
      }
      if (scaleTextRef.current) {
        scaleTextRef.current.textContent = meters + ' m';
      }
    }, [drawGrid]);

    const aspect = useCallback(() => {
      const mapEl = mapDivRef.current;
      if (!mapEl) return;
      const r = mapEl.getBoundingClientRect();
      const ratio = r.width / r.height;
      if (!ratio || !Number.isFinite(ratio)) return;
      const view = viewRef.current;
      const cx = view.x + view.w / 2;
      const cy = view.y + view.h / 2;
      if (view.w / view.h < ratio) view.w = view.h * ratio;
      else view.h = view.w / ratio;
      view.x = cx - view.w / 2;
      view.y = cy - view.h / 2;
    }, []);

    const fit = useCallback(() => {
      const s = currentScene();
      const m = currentMap();
      if (!s.boundary || s.boundary.length < 3) {
        const pad = Math.max(16, m.widthMeters * 0.05);
        viewRef.current = {
          x: -pad,
          y: -pad,
          w: m.widthMeters + pad * 2,
          h: m.heightMeters + pad * 2,
        };
        aspect();
        applyView();
        return;
      }
      const pts = s.boundary.map((p) => world(p, m));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      viewRef.current = {
        x: minX - 35,
        y: minY - 28,
        w: maxX - minX + 70,
        h: maxY - minY + 56,
      };
      aspect();
      applyView();
    }, [currentScene, currentMap, aspect, applyView]);

    const zoom = useCallback(
      (
        factor: number,
        p: Point = [
          viewRef.current.x + viewRef.current.w / 2,
          viewRef.current.y + viewRef.current.h / 2,
        ]
      ) => {
        const view = viewRef.current;
        const w = Math.max(35, Math.min(900, view.w * factor));
        const k = w / view.w;
        viewRef.current = {
          x: p[0] - (p[0] - view.x) * k,
          y: p[1] - (p[1] - view.y) * k,
          w,
          h: view.h * k,
        };
        applyView();
      },
      [applyView]
    );

    const drawBase = useCallback(() => {
      const baseEl = baseLayerRef.current;
      if (!baseEl) return;
      const m = currentMap();
      let html = `<rect x="-2000" y="-2000" width="5000" height="5000" fill="#edf0e5"/><rect width="${m.widthMeters}" height="${m.heightMeters}" fill="url(#paper)"/>`;

      const renderVectorFeatures = (
        vecFeatures: Array<{tags: Record<string, string>; points: Point[]}>
      ): string => {
        const ptsStr = (pts: Point[]) => pts.map((p) => p.join(',')).join(' ');
        let svg = '';
        for (const f of vecFeatures) {
          const t = f.tags;
          if (
            t.leisure === 'park' ||
            t.landuse === 'grass' ||
            t.landuse === 'forest' ||
            t.landuse === 'meadow' ||
            t.leisure === 'garden' ||
            t.natural === 'wood'
          ) {
            svg += `<polygon points="${ptsStr(f.points)}" fill="${
              t.leisure === 'park' ? '#dbe4c9' : '#d2dfbe'
            }" stroke="#c6d3b2" stroke-width=".35"/>`;
          }
          if (t.natural === 'water') {
            svg += `<polygon points="${ptsStr(f.points)}" fill="#b8d4d1" stroke="#8fb8b5" stroke-width=".4"/>`;
          }
          if (
            t.leisure === 'pitch' ||
            t.leisure === 'track' ||
            t.leisure === 'playground'
          ) {
            svg += `<polygon points="${ptsStr(f.points)}" fill="#d4dcc4" stroke="#b7c4a5" stroke-width=".5"/>`;
          }
          if (
            t.place === 'square' ||
            (t.highway === 'pedestrian' && t.area === 'yes')
          ) {
            svg += `<polygon points="${ptsStr(f.points)}" fill="#ebede2" stroke="#cfd5c3" stroke-width=".45"/>`;
          }
        }
        for (const f of vecFeatures.filter(
          (feat) => feat.tags.highway && feat.tags.area !== 'yes'
        )) {
          const t = f.tags;
          const foot = [
            'footway',
            'path',
            'steps',
            'pedestrian',
            'cycleway',
          ].includes(t.highway || '');
          const w = foot
            ? t.highway === 'pedestrian'
              ? 6
              : 2
            : t.highway === 'service'
              ? 4
              : 7;
          svg += `<polyline points="${ptsStr(f.points)}" fill="none" stroke="${
            foot ? '#f5f5e9' : '#cdd3c5'
          }" stroke-width="${w + 1}" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${ptsStr(
            f.points
          )}" fill="none" stroke="${
            foot ? '#f8f7ed' : '#fafbf5'
          }" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
        }
        for (const f of vecFeatures.filter((feat) => feat.tags.building)) {
          svg += `<polygon points="${ptsStr(f.points)}" fill="#d7dccf" stroke="#bac5b0" stroke-width=".45"/>`;
        }
        return svg;
      };

      const renderStreetLabels = (
        vecFeatures: Array<{tags: Record<string, string>; points: Point[]}>
      ): string => {
        if (!labelsVisible) return '';
        let svg = '';
        const names = new Map<string, {pts: Point[]; d: number}>();
        for (const f of vecFeatures.filter(
          (feat) => feat.tags.highway && feat.tags.name
        )) {
          const pts = f.points;
          const d = polylineLength(pts);
          const nameKey = f.tags.name!;
          if (d > (names.get(nameKey)?.d || 0)) {
            names.set(nameKey, {pts, d});
          }
        }
        for (const [name, {pts, d}] of names) {
          if (d < 25) continue;
          let best: [Point, Point] = [pts[0], pts[1]];
          let max = 0;
          for (let i = 1; i < pts.length; i++) {
            const dd = Math.hypot(
              pts[i][0] - pts[i - 1][0],
              pts[i][1] - pts[i - 1][1]
            );
            if (dd > max) {
              max = dd;
              best = [pts[i - 1], pts[i]];
            }
          }
          const [a, b] = best;
          const x = (a[0] + b[0]) / 2;
          const y = (a[1] + b[1]) / 2;
          let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          if (angle > 90 || angle < -90) angle += 180;
          svg += `<text class="street-label" transform="translate(${x} ${y}) rotate(${angle})" text-anchor="middle" font-size="2.1" dy="-.8">${esc(name)}</text>`;
        }
        return svg;
      };

      if (m.customLocation) {
        const cl = m.customLocation;
        const hasVector = (cl.features?.length || 0) > 0;
        html += `<defs><clipPath id="custom-square-clip"><rect x="0" y="0" width="${m.widthMeters}" height="${m.heightMeters}"/></clipPath></defs>`;
        html += '<g clip-path="url(#custom-square-clip)">';
        if (base === 'ortho') {
          const tiles = computeMapTiles(cl.lat, cl.lon, cl.sizeMeters, 'ortho');
          for (const t of tiles) {
            html += `<image href="${esc(t.url)}" x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" preserveAspectRatio="none"/>`;
          }
          if (hasVector) {
            html += renderStreetLabels(cl.features!);
          }
        } else if (hasVector) {
          // Plano vectorial editorial limpio (idéntico al estilo de Plaza del Cristo)
          html += renderVectorFeatures(cl.features!);
          html += renderStreetLabels(cl.features!);
        } else {
          // Respaldo limpio sin iconos ni etiquetas comerciales si aún no hay geometría vectorial
          const tiles = computeMapTiles(cl.lat, cl.lon, cl.sizeMeters, 'plan');
          for (const t of tiles) {
            const cleanUrl = `https://a.basemaps.cartocdn.com/light_nolabels/${t.z}/${t.tx}/${t.ty}.png`;
            html += `<image href="${esc(cleanUrl)}" x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" preserveAspectRatio="none" opacity="0.85"/>`;
          }
        }
        html += '</g>';
        // Marco del área cuadrada operativa y cruz central de referencia
        const cx = m.widthMeters / 2;
        const cy = m.heightMeters / 2;
        html += `<rect x="0" y="0" width="${m.widthMeters}" height="${m.heightMeters}" fill="none" stroke="#4b2665" stroke-width="1.1" stroke-dasharray="4 2.5"/>`;
        if (onboardingStage === 'perimeter') {
          html += `<g opacity=".7" pointer-events="none"><line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}" stroke="#4b2665" stroke-width=".6"/><line x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}" stroke="#4b2665" stroke-width=".6"/><circle cx="${cx}" cy="${cy}" r="2.2" fill="#e4cfa2" stroke="#4b2665" stroke-width=".6"/></g>`;
        }
        baseEl.innerHTML = html;
        return;
      }

      const localFeatures = CARTO_DATA.features
        .filter((f) =>
          f.points.some((p) => {
            const [x, y] = localPoint(p, m);
            return (
              x >= -30 &&
              y >= -30 &&
              x <= m.widthMeters + 30 &&
              y <= m.heightMeters + 30
            );
          })
        )
        .map((f) => ({
          tags: f.tags,
          points: f.points.map((p) => localPoint(p, m)),
        }));

      if (base === 'ortho') {
        html += `<image href="${ORTHO_IMAGES[activeVenue]}" width="${m.widthMeters}" height="${m.heightMeters}"/>`;
      } else {
        html += renderVectorFeatures(localFeatures);
      }
      html += renderStreetLabels(localFeatures);
      baseEl.innerHTML = html;
    }, [currentMap, base, activeVenue, labelsVisible, onboardingStage]);

    const drawAnnotations = useCallback(() => {
      const annEl = annotationLayerRef.current;
      if (!annEl) return;
      const s = phaseScene(currentScene(), phase);
      const m = currentMap();
      let html = '';
      for (const o of s.annotations) {
        const [x, y] = world([o.x, o.y], m);
        html += `<g class="note-marker" data-id="${esc(o.id)}"><circle cx="${x}" cy="${y}" r="2.7" fill="#fbf5cf" stroke="#a29a50" stroke-width=".35"/><text x="${x}" y="${y + 0.8}" text-anchor="middle" font-size="2.7" fill="#666234">${
          s.annotations.indexOf(o) + 1
        }</text><title>${esc(o.cell + ': ' + o.text)}</title></g>`;
      }
      for (const o of s.measurements) {
        const p = o.points.map((pt) => world(pt, m));
        const mid = p[Math.floor(p.length / 2)];
        html += `<polyline data-id="${esc(o.id)}" points="${p
          .map((pt) => pt.join(','))
          .join(' ')}" fill="none" stroke="#656395" stroke-width=".5"/><text x="${
          mid[0]
        }" y="${
          mid[1] - 2
        }" text-anchor="middle" font-size="2.2" fill="#514e7e" paint-order="stroke" stroke="white" stroke-width=".7">${num(
          polylineLength(p)
        )} m</text>`;
      }
      annEl.innerHTML = html;
    }, [currentScene, currentMap, phase]);

    const drawScenario = useCallback(() => {
      const scenEl = scenarioLayerRef.current;
      if (!scenEl) return;
      const rawScene = currentScene();
      const m = currentMap();
      let s = phaseScene(rawScene, phase);

      if (proposal && showAlternative) {
        const byId = new Map(proposal.moves.map((o) => [o.id, o]));
        const replace = <T extends {id: string}>(o: T): T =>
          (byId.get(o.id) as T) || o;
        s = {
          ...s,
          ...(proposal.routing || {}),
          base: {
            ...s.base,
            booths: [
              ...s.base.booths.map(replace),
              ...(proposal.objects.filter(
                (o) => o.role !== 'cover'
              ) as Booth[]),
            ],
          },
          infrastructure: [
            ...s.infrastructure.map(replace),
            ...(proposal.objects.filter(
              (o) => o.role === 'cover'
            ) as Infrastructure[]),
          ],
        };
      }

      const pts = (p: Point[]) => p.map((q) => world(q, m).join(',')).join(' ');
      let html =
        s.boundary && s.boundary.length >= 3
          ? `<polygon points="${pts(s.boundary)}" fill="${
              base === 'plan' ? '#e3ebba' : '#e5ebc0'
            }" fill-opacity=".14" stroke="#8b9852" stroke-width=".6" stroke-dasharray="2 1.2"/>`
          : '';

      for (const o of s.reserves) {
        html += `<polygon data-id="${esc(o.id)}" points="${pts(
          o.points
        )}" fill="#879576" fill-opacity=".12" stroke="#a7b193" stroke-width=".25"><title>${esc(
          o.name
        )}</title></polygon>`;
      }
      if (routesVisible) {
        for (const o of s.flows || []) {
          html += `<polyline data-id="${esc(o.id)}" points="${pts(
            o.points
          )}" fill="none" stroke="#739eac" stroke-opacity=".25" stroke-width="${
            o.width || 3
          }"/><polyline points="${pts(
            o.points
          )}" fill="none" stroke="#588996" stroke-width=".4" stroke-dasharray="1.5 1.2" pointer-events="none"/>`;
        }
      }
      for (const a of (s.passages || []).filter(
        (r) => r.origin === 'boundary-add'
      )) {
        html += `<polygon data-id="${esc(a.id)}" points="${pts(
          a.points
        )}" fill="#70af9e" fill-opacity=".18" stroke="#387f82" stroke-width=".5" stroke-dasharray="2 1"/>`;
      }
      const selectedSet = new Set(selectedIds);
      for (const f of s.fences || []) {
        html += `<g data-id="${esc(f.id)}"><title>${esc(
          f.name || 'Valla'
        )}</title><polyline points="${pts(
          f.points
        )}" fill="none" stroke="transparent" stroke-width="3"/><polyline points="${pts(
          f.points
        )}" fill="none" stroke="${
          f.id && selectedSet.has(f.id) ? '#e18f2f' : '#806e55'
        }" stroke-width=".6"/></g>`;
      }
      for (const o of [...s.base.booths, ...s.infrastructure]) {
        const [x, y] = world([o.x, o.y], m);
        const oArea = (o as Booth).area || 24;
        const w = o.width || Math.sqrt(oArea);
        const h = o.depth || Math.sqrt(oArea);
        const sel = selectedSet.has(o.id);
        const isCover = (o as Infrastructure).role === 'cover';
        const oKind = (o as Infrastructure).kind;
        html += `<g data-id="${esc(
          o.id
        )}" class="map-item" transform="translate(${x} ${y}) rotate(${
          o.rotation || 0
        })"><title>${esc(o.name)} · ${w} × ${h} m</title><rect x="${
          -w / 2
        }" y="${-h / 2}" width="${w}" height="${h}" rx=".35" fill="${itemColor(
          o
        )}" fill-opacity="${isCover ? 0.35 : 0.96}" stroke="${
          sel ? '#4b2665' : '#8c8f66'
        }" stroke-width="${sel ? 0.65 : 0.3}"/>${
          isCover
            ? `<path d="M${-w / 2},${-h / 2}L${w / 2},${h / 2}M${w / 2},${
                -h / 2
              }L${-w / 2},${h / 2}" stroke="#77937d" stroke-width=".2"/>`
            : ''
        }${objectSkin(o, w, h)}<text y="${
          h / 2 + 1.5
        }" text-anchor="middle" dominant-baseline="central" font-size="${Math.min(
          1.8,
          h * 0.28,
          w * 0.2
        )}" fill="#3c5140" pointer-events="none">${esc(
          oKind === 'medical'
            ? '✚'
            : oKind === 'toilet'
              ? 'WC'
              : o.name.split(' ').slice(0, 2).join(' ')
        )}</text>${
          sel
            ? `<rect class="selection-ring" x="${-w / 2 - 1}" y="${
                -h / 2 - 1
              }" width="${w + 2}" height="${h + 2}" rx=".7"/>`
            : ''
        }</g>`;
      }
      const flowMetrics = new Map(
        normalizeAccessFlows(s.entrances, s.base.arrivals).map((fm) => [
          fm.id,
          fm,
        ])
      );
      for (const o of s.entrances) {
        const [x, y] = world([o.x, o.y], m);
        const w = o.clearWidth || 4;
        const angle = ((o.gateAngle || 0) * Math.PI) / 180;
        const dx = (Math.cos(angle) * w) / 2;
        const dy = (Math.sin(angle) * w) / 2;
        const role = o.phases?.event || o.role || 'both';
        const spawnType = o.spawnType || 'pedestrian';
        const strokeColor =
          spawnType === 'vehicle'
            ? '#b8682a'
            : spawnType === 'mixed'
              ? '#644099'
              : '#5374a0';
        const textColor =
          spawnType === 'vehicle'
            ? '#8c4916'
            : spawnType === 'mixed'
              ? '#4b2665'
              : '#294d80';
        const typeTag =
          spawnType === 'vehicle' ? 'VEH' : spawnType === 'mixed' ? 'MIX' : 'PEA';
        const fm = flowMetrics.get(o.id);
        const shareTag =
          fm && fm.canEnter && fm.entrySharePct > 0
            ? ` · ${Math.round(fm.entrySharePct)}%`
            : '';
        // Calcula normal hacia el INTERIOR del perímetro para orientar flechas entrada/salida
        const snapInfo = snapPointToPerimeter([x, y], s, m);
        const [nx, ny] = snapInfo
          ? snapInfo.inwardNormal
          : [-Math.sin(angle), Math.cos(angle)];
        const px = -ny;
        const py = nx;
        const arrowHalf = 2.6;
        const headLen = 1.25;
        const headW = 0.85;
        const buildHead = (tipX: number, tipY: number, dirX: number, dirY: number) =>
          `M${tipX - dirX * headLen + px * headW},${tipY - dirY * headLen + py * headW}L${tipX},${tipY}L${tipX - dirX * headLen - px * headW},${tipY - dirY * headLen - py * headW}`;
        const outX = x - nx * arrowHalf;
        const outY = y - ny * arrowHalf;
        const inX = x + nx * arrowHalf;
        const inY = y + ny * arrowHalf;
        let dirGraphic = '';
        if (role === 'closed') {
          dirGraphic = `<text x="${x}" y="${y + 1}" text-anchor="middle" fill="#a83232" stroke="white" stroke-width=".6" paint-order="stroke" font-size="3.4" font-weight="700">×</text>`;
        } else {
          let arrowPath = `M${outX},${outY}L${inX},${inY}`;
          if (role === 'in') {
            // Flecha apuntando hacia el INTERIOR del perímetro
            arrowPath += buildHead(inX, inY, nx, ny);
          } else if (role === 'out') {
            // Flecha apuntando hacia el EXTERIOR del perímetro
            arrowPath += buildHead(outX, outY, -nx, -ny);
          } else {
            // Doble flecha (entrada y salida / acceso libre)
            arrowPath +=
              buildHead(inX, inY, nx, ny) + buildHead(outX, outY, -nx, -ny);
          }
          dirGraphic = `<path d="${arrowPath}" fill="none" stroke="white" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="${arrowPath}" fill="none" stroke="${textColor}" stroke-width=".6" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        const isEntSel = selectedSet.has(o.id);
        html += `<g data-id="${esc(o.id)}" class="map-item">${
          isEntSel
            ? `<circle class="selection-ring" cx="${x}" cy="${y}" r="${Math.max(2.6, w / 2 + 1)}"/>`
            : ''
        }<line x1="${
          x - dx
        }" y1="${y - dy}" x2="${x + dx}" y2="${
          y + dy
        }" stroke="${strokeColor}" stroke-width=".95"/><circle cx="${x - dx}" cy="${
          y - dy
        }" r=".5" fill="#fff" stroke="${strokeColor}" stroke-width=".2"/><circle cx="${
          x + dx
        }" cy="${
          y + dy
        }" r=".5" fill="#fff" stroke="${strokeColor}" stroke-width=".2"/>${dirGraphic}<text x="${x}" y="${
          y + 4.4
        }" text-anchor="middle" font-size="1.55" fill="${textColor}" paint-order="stroke" stroke="white" stroke-width=".6">[${typeTag}] ${esc(
          o.name
        )} · ${num(w)} m${shareTag}</text></g>`;
      }
      for (const o of s.roadPlans || []) {
        html += `<polyline data-id="${esc(o.id)}" points="${pts(
          o.points
        )}" fill="none" stroke="#b96858" stroke-width="1.2" stroke-dasharray="2 1.2"><title>${esc(
          o.name
        )}</title></polyline>`;
      }

      const selectedObject = [...s.base.booths, ...s.infrastructure].find(
        (o) => o.id === selectedId
      );
      if (panel === 'design' && !proposal && selectedObject) {
        const clientW = mapDivRef.current?.clientWidth || 800;
        html += transformHandles(
          selectedObject,
          m,
          clientW / viewRef.current.w
        );
      }

      scenEl.innerHTML = html;

      if (proposal && showAlternative) {
        const moved = new Set(proposal.moves.map((o) => o.id));
        for (const el of scenEl.querySelectorAll<SVGGElement>('[data-id]')) {
          if (el.dataset.id && moved.has(el.dataset.id)) {
            const r = el.querySelector('rect');
            if (r) {
              r.setAttribute('stroke', '#633584');
              r.setAttribute('stroke-width', '.6');
            }
          }
        }
      }

      if (phase === 'all') {
        const allItems = [
          ...rawScene.base.booths,
          ...rawScene.infrastructure,
          ...rawScene.entrances,
        ];
        for (const node of scenEl.querySelectorAll<SVGGElement>('g[data-id]')) {
          const obj = allItems.find((item) => item.id === node.dataset.id);
          if (!obj) continue;
          const tags = membership(obj);
          const shape = node.querySelector('rect,circle');
          if (shape) {
            shape.setAttribute('stroke', phaseColors[tags[0]] || '#555');
            shape.setAttribute('stroke-width', '.7');
            if (tags.length > 1) shape.setAttribute('stroke-dasharray', '1 .5');
          }
          const title = node.querySelector('title');
          if (title) {
            title.textContent +=
              ' · ' + tags.map((k) => phases[k]).join(' / ');
          }
        }
      }

      drawAnnotations();
    }, [
      currentScene,
      currentMap,
      phase,
      proposal,
      showAlternative,
      base,
      routesVisible,
      selectedId,
      selectedIds,
      panel,
      drawAnnotations,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        fit,
        drawBase,
        drawGrid,
        drawScenario,
      }),
      [fit, drawBase, drawGrid, drawScenario]
    );

    useEffect(() => {
      drawBase();
      drawGrid();
    }, [
      drawBase,
      drawGrid,
      activeVenue,
      base,
      labelsVisible,
      gridVisible,
      grid,
      revision,
    ]);

    // Si se abre un escenario personalizado antiguo o guardado sin capa vectorial,
    // genera automáticamente su versión vectorial limpia una sola vez y la persiste.
    useEffect(() => {
      const m = currentMap();
      const cl = m.customLocation;
      if (!cl || (cl.features && cl.features.length > 0)) return;
      if (hydratedCustomMapRef.current === m.source) return;
      hydratedCustomMapRef.current = m.source;
      let cancelled = false;
      fetchOsmVectorContext(cl.lat, cl.lon, cl.sizeMeters, 9000)
        .then(({streets, features}) => {
          if (cancelled || !features.length) return;
          setCustomMapVectors(streets, features);
        })
        .catch(() => {
          // Mantiene el respaldo limpio si no hay conexión
        });
      return () => {
        cancelled = true;
      };
    }, [currentMap, activeVenue, revision, setCustomMapVectors]);

    useEffect(() => {
      drawScenario();
    }, [drawScenario, revision, selectedIds, phase, proposal, showAlternative, routesVisible]);

    useEffect(() => {
      setDraftPoints([]);
      boundaryModeRef.current = 'replace';
      setBoundaryMode('replace');
    }, [tool]);

    useEffect(() => {
      const draftEl = draftLayerRef.current;
      if (!draftEl) return;
      draftEl.innerHTML = buildDraftSvg(draftPoints, tool, boundaryMode);
    }, [draftPoints, tool, boundaryMode]);

    useEffect(() => {
      const mapEl = mapDivRef.current;
      if (!mapEl) return;
      const ro = new ResizeObserver(() => {
        aspect();
        applyView();
      });
      ro.observe(mapEl);
      fit();

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const q = pt.matrixTransform(ctm.inverse());
        zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, [q.x, q.y]);
      };
      mapEl.addEventListener('wheel', onWheel, {passive: false});
      return () => {
        ro.disconnect();
        mapEl.removeEventListener('wheel', onWheel);
      };
    }, [aspect, applyView, fit, zoom]);

    const getPointerCoords = (e: React.PointerEvent): Point => {
      const svg = svgRef.current;
      if (!svg) return [0, 0];
      const ctm = svg.getScreenCTM();
      if (!ctm) return [0, 0];
      const p = svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      const q = p.matrixTransform(ctm.inverse());
      return [q.x, q.y];
    };

    const finishDraw = () => {
      const isPolygon = ['boundary', 'reserve', 'xray:boundary'].includes(tool);
      if (draftPoints.length < (isPolygon ? 3 : 2)) return;
      const m = currentMap();
      if (tool === 'gateLine' || tool === 'xray:wall') {
        const a = draftPoints[0];
        const b = draftPoints[draftPoints.length - 1];
        const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (w < 0.5 || w > (tool === 'xray:wall' ? 500 : 100)) {
          showToast(
            tool === 'xray:wall'
              ? 'El muro debe medir al menos 0,5 metros.'
              : 'El acceso debe medir entre 0,5 y 100 metros.'
          );
          return;
        }
      }
      const p = draftPoints.map((pt) => percent(pt, m));
      const id = crypto.randomUUID();
      let createdSubsoilId: string | null = null;
      const completingOnboardingPerimeter =
        tool === 'boundary' && onboardingStage === 'perimeter';
      let detectedSummary: {total: number; ped: number; veh: number} | null =
        null;
      updateScene((s) => {
        if (tool === 'xray:boundary') {
          createdSubsoilId = commitSubsoilBoundary(
            s,
            draftPoints,
            boundaryModeRef.current,
            m
          );
        } else if (tool === 'xray:wall') {
          createdSubsoilId = commitSubsoilWall(
            s,
            draftPoints[0],
            draftPoints[draftPoints.length - 1],
            m
          );
        } else if (tool === 'gateLine') {
          const a = draftPoints[0];
          const b = draftPoints[draftPoints.length - 1];
          const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const snap = snapPointToPerimeter(mid, s, m);
          if (!snap) {
            return;
          }
          s.entrances.push({
            id,
            name: 'Acceso',
            kind: 'gate',
            x: snap.percentPoint[0],
            y: snap.percentPoint[1],
            clearWidth: Math.min(w, Math.max(0.5, snap.edgeLength)),
            gateAngle: snap.gateAngle,
            role: 'both',
            phases: {event: 'both'},
            phaseTags: tagsForNew(),
            spawnType: 'pedestrian',
            entryWeight: 20,
            exitWeight: 20,
            maxRatePerHour: 0,
          });
        } else if (tool === 'boundary') {
          if (boundaryModeRef.current === 'add' && !completingOnboardingPerimeter) {
            s.passages ??= [];
            s.passages.push({
              id,
              name: 'Ampliación del perímetro',
              points: p,
              origin: 'boundary-add',
            });
          } else if (
            boundaryModeRef.current === 'subtract' &&
            !completingOnboardingPerimeter
          ) {
            s.reserves.push({
              id,
              name: 'Área restada del perímetro',
              points: p,
              origin: 'boundary-subtract',
              phaseTags: ['pre', 'event', 'post'],
            });
          } else {
            s.boundary = p;
            s.passages = (s.passages || []).filter(
              (r) => r.origin !== 'boundary-add'
            );
            s.reserves = s.reserves.filter(
              (r) => r.origin !== 'boundary-subtract'
            );
            if (completingOnboardingPerimeter || !s.entrances.length) {
              const generated = generateCoherentSpawns(
                p,
                m,
                m.customLocation ? undefined : CARTO_DATA
              );
              if (generated.length) {
                s.entrances = generated;
                detectedSummary = {
                  total: generated.length,
                  ped: generated.filter((e) => e.spawnType !== 'vehicle').length,
                  veh: generated.filter((e) => e.spawnType === 'vehicle').length,
                };
              }
            } else {
              // Mantiene todos los accesos existentes acoplados al nuevo borde del perímetro
              s.entrances = s.entrances.map((ent) =>
                snapEntranceToPerimeter(ent, s, m)
              );
            }
          }
        } else if (tool === 'reserve') {
          s.reserves.push({
            id,
            phaseTags: tagsForNew(),
            name: 'Zona excluida',
            points: p,
            origin: 'Dibujada por el equipo',
          });
        } else if (tool === 'flow') {
          s.flows ??= [];
          s.flows.push({
            id,
            phaseTags: tagsForNew(),
            name: 'Paso peatonal propuesto',
            width: 3,
            points: p,
          });
          s.corridors = structuredClone(s.flows);
        } else if (tool === 'road') {
          s.roadPlans.push({
            id,
            phaseTags: tagsForNew(),
            name: 'Propuesta vial · revisar',
            points: p,
          });
        } else {
          s.measurements.push({
            id,
            phaseTags: tagsForNew(),
            name: 'Medición ' + (s.measurements.length + 1),
            points: p,
          });
        }
      }, true);
      setDraftPoints([]);
      if (completingOnboardingPerimeter) {
        setOnboardingStage('inventory');
        setTool('select');
        setActiveModal('inventory');
        if (detectedSummary) {
          const sum = detectedSummary as {
            total: number;
            ped: number;
            veh: number;
          };
          showToast(
            `Perímetro definido y ${sum.total} accesos detectados (${sum.ped} peatonales, ${sum.veh} vehiculares). Define ahora el inventario.`
          );
        } else {
          showToast('Perímetro definido. Ahora configura el inventario del evento.');
        }
        setTimeout(() => fit(), 40);
        onSceneChanged();
        return;
      }
      const wasXray = tool.startsWith('xray:');
      setTool(wasXray ? 'xray:select' : 'select');
      if (createdSubsoilId) setSelectedIds([createdSubsoilId]);
      onSceneChanged();
    };

    const addCatalogItem = (kind: string, p: Point) => {
      if (panel === 'simulate') return;
      const s = currentScene();
      const m = currentMap();
      if (
        s.base.booths.length + s.infrastructure.length + s.entrances.length >=
        150
      ) {
        showToast('Límite del prototipo: 150 elementos por espacio');
        return;
      }
      const c = CATALOG[kind];
      if (!c) return;
      let [x, y] = percent(p, m);
      let gateSnapAngle = 0;
      if (kind === 'gate') {
        const snap = snapPointToPerimeter(p, s, m);
        if (!snap) {
          showToast(
            'Define primero un perímetro para poder colocar accesos en su borde.'
          );
          return;
        }
        if (snap.dist > 22) {
          showToast(
            'Los accesos solo pueden colocarse pegados al borde de un perímetro.'
          );
          return;
        }
        [x, y] = snap.percentPoint;
        gateSnapAngle = snap.gateAngle;
      }
      const id = crypto.randomUUID();
      updateScene((sc) => {
        const baseObj = {
          phaseTags:
            kind === 'bin'
              ? (['pre', 'event', 'post'] as PhaseKey[])
              : tagsForNew(),
          id,
          kind,
          name: c.name,
          x,
          y,
          width: c.w,
          depth: c.h,
          area: c.w * c.h,
          rotation: 0,
        };
        if (kind === 'gate') {
          sc.entrances.push({
            ...baseObj,
            role: 'both',
            clearWidth: 4,
            gateAngle: gateSnapAngle,
            phases: {event: 'both'},
            spawnType: 'pedestrian',
            entryWeight: 20,
            exitWeight: 20,
            maxRatePerHour: 0,
          });
        } else if (c.role) {
          sc.infrastructure.push({
            ...baseObj,
            role: c.role,
            capacity:
              kind === 'picnic' ? 6 : c.role === 'emergency' ? 1 : 10,
            staff: c.role === 'emergency' ? 2 : 0,
            delay:
              ({
                fire: 90,
                medical: 30,
                security: 15,
                patrol: 30,
                ambulance: 60,
              } as Record<string, number>)[kind] ?? 60,
            handling:
              ({
                fire: 360,
                medical: 180,
                security: 120,
                patrol: 120,
                ambulance: 240,
              } as Record<string, number>)[kind] ?? 240,
            active: true,
            cost: 0,
          });
        } else {
          sc.base.booths.push({
            ...baseObj,
            type: c.type || 'commerce',
            time: kind === 'stage' ? 1 : 5,
            simultaneous: kind === 'rest' ? 10 : 3,
            interest: 1,
            labCapacity:
              kind === 'stage' ? 40 : kind === 'rest' ? 10 : 3,
            labTime: kind === 'stage' ? 15 : 5,
            covered: false,
            local: true,
            open: 0,
            close: sc.base.hours,
            price: kind === 'commerce' ? 10 : kind === 'food' ? 8 : 0,
          });
        }
      }, true);
      setTool('select');
      setSelectedId(id);
      onSceneChanged();
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      const targetEl = e.target as HTMLElement;
      // Ignore pointerdown on floating UI controls inside #map
      if (
        targetEl.closest(
          '#inspector,#layer-panel,.zoom-pad,#draw-confirm,.director-hud,#onboarding-perimeter-banner'
        )
      ) {
        return;
      }
      if (e.button === 1) {
        e.preventDefault();
        dragRef.current = {
          p: getPointerCoords(e),
          client: [e.clientX, e.clientY],
          view: {...viewRef.current},
          id: null,
          o: null,
          old: null,
          handle: null,
          snapshot: null,
          moved: false,
          checkpoint: false,
          panOnly: true,
        };
        if (mapDivRef.current) {
          mapDivRef.current.style.cursor = 'grabbing';
          mapDivRef.current.setPointerCapture(e.pointerId);
        }
        return;
      }
      const p = getPointerCoords(e);
      const id =
        panel === 'simulate'
          ? null
          : targetEl.closest<HTMLElement>('[data-id]')?.dataset.id || null;
      const s = currentScene();
      const m = currentMap();
      const allItems = [
        ...s.base.booths,
        ...s.infrastructure,
        ...s.entrances,
        ...s.annotations,
        ...s.roadPlans,
        ...s.measurements,
        ...(s.flows || []),
        ...s.reserves,
        ...(s.fences || []),
        ...(s.passages || []),
      ];
      let resolvedId = id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let o: any = resolvedId
        ? allItems.find((item) => item.id === resolvedId) || null
        : null;
      let xrayKind: 'column' | 'wall' | 'polygon' | null = null;
      let xrayHandle: 'a' | 'b' | null = null;
      if (panel === 'design' && xrayVisible && !o) {
        const subHit = resolveSubsoilPointerDown(
          targetEl,
          s,
          p,
          m,
          selectedIds,
          resolvedId
        );
        if (subHit) {
          resolvedId = subHit.id;
          o = subHit.item;
          xrayKind = subHit.kind;
          xrayHandle = subHit.handle || null;
        }
      }
      const handle =
        panel === 'design'
          ? targetEl.closest<HTMLElement>('[data-handle]')?.dataset.handle ||
            null
          : null;
      dragRef.current = {
        p,
        client: [e.clientX, e.clientY],
        view: {...viewRef.current},
        id: resolvedId,
        o,
        old:
          o && Number.isFinite(o.x) && Number.isFinite(o.y)
            ? [o.x, o.y]
            : null,
        handle,
        xrayKind,
        xrayHandle,
        snapshot: o ? structuredClone(o) : null,
        moved: false,
        checkpoint: false,
      };
      mapDivRef.current?.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const p = getPointerCoords(e);
      const m = currentMap();
      if (cellSpanRef.current) {
        cellSpanRef.current.textContent = 'CELDA ' + cellAt(p, grid);
      }
      if (coordsSpanRef.current) {
        coordsSpanRef.current.textContent = `E ${num(m.bbox[0] + p[0])} · N ${num(
          m.bbox[3] - p[1]
        )} / UTM 28N`;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.client[0];
      const dy = e.clientY - drag.client[1];
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (!drag.moved) return;

      if (drag.panOnly && mapDivRef.current) {
        const clientW = mapDivRef.current.clientWidth || 800;
        const clientH = mapDivRef.current.clientHeight || 600;
        viewRef.current.x = drag.view.x - (dx / clientW) * drag.view.w;
        viewRef.current.y = drag.view.y - (dy / clientH) * drag.view.h;
        applyView();
        return;
      }

      const isSelectLike = tool === 'select' || tool === 'xray:select';

      if (
        isSelectLike &&
        drag.xrayKind === 'wall' &&
        drag.o &&
        drag.snapshot &&
        drag.id &&
        panel === 'design'
      ) {
        if (!drag.checkpoint) {
          checkpoint();
          drag.checkpoint = true;
          onSceneChanged();
        }
        applyWallDrag(
          drag.o,
          drag.snapshot,
          drag.p,
          p,
          m,
          drag.xrayHandle || undefined
        );
        setSelectedIds([drag.id]);
        useProjectStore.setState((st) => ({revision: st.revision + 1}));
        return;
      }

      if (
        isSelectLike &&
        drag.o?.points &&
        drag.snapshot?.points &&
        drag.id
      ) {
        if (!drag.checkpoint) {
          checkpoint();
          drag.checkpoint = true;
          onSceneChanged();
        }
        const dPctX = ((p[0] - drag.p[0]) / m.widthMeters) * 100;
        const dPctY = ((p[1] - drag.p[1]) / m.heightMeters) * 100;
        const moved = (drag.snapshot.points as Point[]).map(
          (q): Point => [q[0] + dPctX, q[1] + dPctY]
        );
        if (
          moved.every(
            (q) => q[0] >= 0 && q[0] <= 100 && q[1] >= 0 && q[1] <= 100
          )
        ) {
          drag.o.points = moved;
          setSelectedId(drag.id);
          if (drag.xrayKind) {
            useProjectStore.setState((st) => ({revision: st.revision + 1}));
          } else {
            drawScenario();
          }
        }
        return;
      }

      if (drag.handle && panel === 'design' && drag.snapshot && drag.o) {
        if (!drag.checkpoint) {
          checkpoint();
          drag.checkpoint = true;
          onSceneChanged();
        }
        const patch = transformObject(
          drag.snapshot,
          m,
          drag.p,
          p,
          drag.handle,
          e.shiftKey
        );
        if (patch) {
          Object.assign(drag.o, patch);
          drawScenario();
        }
        return;
      }

      if (isSelectLike && drag.old && drag.o && drag.id) {
        if (!drag.checkpoint) {
          checkpoint();
          drag.checkpoint = true;
          onSceneChanged();
        }
        setSelectedId(drag.id);
        const s = currentScene();
        if (s.entrances.includes(drag.o)) {
          const snap = snapPointToPerimeter(p, s, m);
          if (snap) {
            drag.o.x = snap.percentPoint[0];
            drag.o.y = snap.percentPoint[1];
            drag.o.gateAngle = snap.gateAngle;
          }
        } else {
          drag.o.x = Math.max(
            0,
            Math.min(100, drag.old[0] + ((p[0] - drag.p[0]) / m.widthMeters) * 100)
          );
          drag.o.y = Math.max(
            0,
            Math.min(
              100,
              drag.old[1] + ((p[1] - drag.p[1]) / m.heightMeters) * 100
            )
          );
        }
        if (s.annotations.includes(drag.o)) {
          drag.o.cell = cellAt(
            world([drag.o.x, drag.o.y], m),
            drag.o.grid || grid
          );
        }
        if (drag.xrayKind) {
          useProjectStore.setState((st) => ({revision: st.revision + 1}));
        } else {
          drawScenario();
        }
      } else if (isSelectLike && mapDivRef.current) {
        const clientW = mapDivRef.current.clientWidth || 800;
        const clientH = mapDivRef.current.clientHeight || 600;
        viewRef.current.x = drag.view.x - (dx / clientW) * drag.view.w;
        viewRef.current.y = drag.view.y - (dy / clientH) * drag.view.h;
        applyView();
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      if (d.panOnly && mapDivRef.current) {
        mapDivRef.current.style.cursor = '';
      }
      try {
        mapDivRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture already lost
      }
      if (d.panOnly) return;
      const p = getPointerCoords(e);
      if (panel === 'simulate') return;
      if (d.moved) {
        if (d.checkpoint) {
          save();
          updateScene(() => {});
        }
        return;
      }
      if (tool === 'select' || tool === 'xray:select') {
        if (e.shiftKey && d.id) toggleSelectedId(d.id);
        else if (d.id) setSelectedIds([d.id]);
        else if (!e.shiftKey) setSelectedIds([]);
        return;
      }
      const m = currentMap();
      if (
        p[0] < 0 ||
        p[1] < 0 ||
        p[0] > m.widthMeters ||
        p[1] > m.heightMeters
      ) {
        showToast('La selección debe estar dentro de la extensión cartográfica');
        return;
      }
      if (tool.startsWith('stock:')) {
        const stockId = tool.slice(6);
        const s = currentScene();
        const obj = (s.pendingStock || []).find((o) => o.id === stockId);
        if (obj) {
          let [x, y] = percent(p, m);
          let extraGate: Record<string, unknown> = {};
          if (obj.kind === 'gate' || obj.inventoryKind === 'gate') {
            const snap = snapPointToPerimeter(p, s, m);
            if (!snap) {
              showToast(
                'Define primero un perímetro para poder colocar accesos en su borde.'
              );
              return;
            }
            if (snap.dist > 22) {
              showToast(
                'Los accesos solo pueden colocarse pegados al borde de un perímetro.'
              );
              return;
            }
            [x, y] = snap.percentPoint;
            extraGate = {gateAngle: snap.gateAngle};
          }
          updateScene((sc) => {
            insertStock(sc, {...obj, x, y, ...extraGate});
          }, true);
          setTool('select');
          setSelectedId(obj.id);
          onSceneChanged();
        }
      } else if (tool.startsWith('place:')) {
        addCatalogItem(tool.split(':')[1], p);
      } else if (tool === 'note') {
        const [x, y] = percent(p, m);
        const id = crypto.randomUUID();
        updateScene((sc) => {
          sc.annotations.push({
            phaseTags: tagsForNew(),
            id,
            x,
            y,
            text: '',
            cell: cellAt(p, grid),
            grid,
          });
        }, true);
        setPanel('review');
        setTool('select');
        setSelectedId(id);
        setTimeout(() => {
          document.getElementById('note-text')?.focus();
        }, 20);
      } else if (tool === 'xray:column') {
        let colId = '';
        updateScene((sc) => {
          colId = placeSubsoilColumn(sc, p, m);
        }, true);
        setTool('xray:select');
        setSelectedIds([colId]);
        onSceneChanged();
      } else if (tool === 'gateLine') {
        const s = currentScene();
        const snap = snapPointToPerimeter(p, s, m);
        if (!snap) {
          showToast(
            'Define primero un perímetro para poder colocar accesos en su borde.'
          );
          return;
        }
        if (snap.dist > 22) {
          showToast(
            'Los accesos solo pueden crearse pegados al borde de un perímetro.'
          );
          return;
        }
        setDraftPoints((prev) => [...prev, snap.point]);
      } else {
        if (
          (tool === 'boundary' || tool === 'xray:boundary') &&
          !draftPoints.length
        ) {
          const nextMode = e.ctrlKey
            ? 'subtract'
            : e.shiftKey
              ? 'add'
              : 'replace';
          boundaryModeRef.current = nextMode;
          setBoundaryMode(nextMode);
          showToast(
            nextMode === 'add'
              ? '+ Añadir área: dibuja y confirma'
              : nextMode === 'subtract'
                ? '− Restar área: dibuja y confirma'
                : 'Sustituir perímetro'
          );
        }
        setDraftPoints((prev) => [...prev, p]);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        if (onboardingStage === 'perimeter') {
          setDraftPoints([]);
        } else {
          setTool('select');
          setSelectedId(null);
        }
      }
      if (e.key === 'Enter' && draftPoints.length) {
        finishDraw();
      }
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        e.preventDefault();
        const step = viewRef.current.w * 0.05;
        viewRef.current.x +=
          e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        viewRef.current.y +=
          e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        applyView();
      }
    };

    const mapModeText =
      panel === 'simulate'
        ? 'Plano bloqueado · arrastra para navegar'
        : tool === 'select'
          ? 'Edición libre'
          : tool.startsWith('stock:')
            ? 'Colocar pieza del inventario'
            : tool.startsWith('place:')
              ? 'Colocar ' + (CATALOG[tool.split(':')[1]]?.name || '')
              : (
                  {
                    measure: 'Medir distancia',
                    note: 'Anotar en el plano',
                    boundary:
                      'Perímetro: Mayús añade · Ctrl resta (primer clic)',
                    reserve: 'Reservar zona',
                    flow: 'Trazar recorrido',
                    gateLine:
                      'Dibujar acceso: marca sus dos extremos sobre el borde del perímetro',
                    road: 'Propuesta vial',
                    'xray:boundary':
                      'Perímetro subsuelo: Mayús añade (+) · Ctrl resta (−)',
                    'xray:column': 'Colocar columna en el subsuelo',
                    'xray:wall': 'Muro de carga: marca los extremos A y B',
                    'xray:select': 'Rayos X · seleccionar o mover subsuelo',
                  } as Record<string, string>
                )[tool] || 'Edición';

    const isDrawingTool = [
      'gateLine',
      'measure',
      'boundary',
      'reserve',
      'flow',
      'road',
      'xray:boundary',
      'xray:wall',
    ].includes(tool);
    const isPolygonTool = ['boundary', 'reserve', 'xray:boundary'].includes(
      tool
    );

    const nightOpacity =
      daylight < 8 || daylight >= 21 ? '0.54' : daylight >= 18 ? '0.27' : '0';
    const sunOpacity = daylight >= 9 && daylight <= 17 ? '0.22' : '0.05';

    const isSimulate = panel === 'simulate';
    const isOnboardingPerimeter = onboardingStage === 'perimeter';

    return (
      <>
        <div
          className={`map-shell ${base === 'ortho' ? 'ortho' : ''}`}
          data-weather={activeWeather}
          style={
            {
              '--night-opacity': nightOpacity,
              '--sun-opacity': sunOpacity,
            } as React.CSSProperties
          }
        >
          <div
            id="map"
            ref={mapDivRef}
            className={tool !== 'select' ? 'drawing' : ''}
            tabIndex={0}
            role="application"
            aria-label="Plano editable. Arrastra para desplazar, rueda para ampliar. Selecciona un elemento para editar sus coordenadas."
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              if (dragRef.current?.panOnly && mapDivRef.current) {
                mapDivRef.current.style.cursor = '';
              }
              if (dragRef.current?.checkpoint) save();
              dragRef.current = null;
            }}
            onKeyDown={handleKeyDown}
          >
            <svg id="drawing" ref={svgRef} xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern
                  id="paper"
                  width="12"
                  height="12"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="1" cy="1" r=".18" fill="#d0c6db" />
                </pattern>
                <marker
                  id="arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="5"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0 0L6 3L0 6Z" fill="#4475a4" />
                </marker>
              </defs>
              <g id="base-layer" ref={baseLayerRef} />
              <g id="grid-layer" ref={gridLayerRef} pointerEvents="none" />
              <g id="heat-layer" pointerEvents="none" />
              <XRayLayer />
              <g id="scenario-layer" ref={scenarioLayerRef} />
              <g id="layout-preview" pointerEvents="none" />
              <g id="dining-layer" pointerEvents="none" />
              <g id="shift-layer" pointerEvents="none" />
              <g id="people-layer" pointerEvents="none" />
              <g id="annotation-layer" ref={annotationLayerRef} />
              <g
                id="draft-layer"
                ref={draftLayerRef}
                pointerEvents="none"
              />
              <g id="response-layer" pointerEvents="none" />
            </svg>
          </div>

          <div id="atmosphere">
            <div className="sunlight" />
            <div className="rain rain-one" />
            <div className="rain rain-two" />
            <div className="night-light" />
          </div>

          <div
            className="map-tools"
            role="group"
            aria-label="Herramientas del plano"
          >
            <button
              type="button"
              data-tool="select"
              className={tool === 'select' ? 'active' : ''}
              title="Seleccionar y mover"
              aria-label="Seleccionar y mover"
              disabled={isSimulate || isOnboardingPerimeter}
              onClick={() => setTool('select')}
            >
              ↖
            </button>
            <button
              type="button"
              data-tool="measure"
              className={tool === 'measure' ? 'active' : ''}
              title="Medir distancias"
              aria-label="Medir distancias"
              disabled={isSimulate || isOnboardingPerimeter}
              onClick={() => setTool('measure')}
            >
              ↔
            </button>
            <button
              type="button"
              data-tool="note"
              className={tool === 'note' ? 'active' : ''}
              title="Añadir observación"
              aria-label="Añadir observación"
              disabled={isSimulate || isOnboardingPerimeter}
              onClick={() => setTool('note')}
            >
              ⊕
            </button>
            <span />
            <button
              type="button"
              id="undo"
              title="Deshacer"
              aria-label="Deshacer"
              disabled={isSimulate || isOnboardingPerimeter || !history.length}
              onClick={() => onUndoRedo(false)}
            >
              ↶
            </button>
            <button
              type="button"
              id="redo"
              title="Rehacer"
              aria-label="Rehacer"
              disabled={isSimulate || isOnboardingPerimeter || !future.length}
              onClick={() => onUndoRedo(true)}
            >
              ↷
            </button>
          </div>

          {isOnboardingPerimeter && (
            <div
              id="onboarding-perimeter-banner"
              className="onboarding-perimeter-banner"
              role="status"
            >
              <span className="onboarding-step-pill">PASO 1 DE 2</span>
              <div>
                <b>Delimita el perímetro operativo del evento sobre el mapa</b>
                <span>
                  Marca al menos 3 vértices sobre el plano y pulsa «Terminar».
                  Después se detectarán los accesos peatonales y vehiculares y
                  pasarás al inventario.
                </span>
              </div>
            </div>
          )}

          <div className="map-top-note">
            <span className="live-dot" />{' '}
            <span id="map-mode">{mapModeText}</span>
            <b>Sin ajuste a cuadrícula</b>
          </div>

          <div className="director-hud">
            <span className="director-indicator" />
            <span>MODO DIRECTOR</span>
            <small>El escenario responde a tus decisiones</small>
            <button
              type="button"
              id="immersive"
              aria-label="Alternar vista inmersiva"
              title="Vista inmersiva"
              onClick={toggleImmersive}
            >
              {immersive ? '↙' : '⛶'}
            </button>
          </div>

          <aside
            id="incident-corner"
            aria-label="Seguimiento de incidencias"
            hidden
          />

          <div className="north" title="Norte arriba">
            <b>N</b>
            <span>↑</span>
          </div>

          <LayerPanel />
          <Inspector
            onSceneChanged={onSceneChanged}
            onClearProposal={onClearProposal}
          />

          <div
            id="draw-confirm"
            className="draw-confirm"
            hidden={!isDrawingTool}
          >
            {(tool === 'boundary' || tool === 'xray:boundary') && (
              <span
                id="draw-mode-badge"
                className={`draw-mode-badge mode-${boundaryMode}`}
              >
                {boundaryMode === 'add'
                  ? '+ Añadir'
                  : boundaryMode === 'subtract'
                    ? '− Restar'
                    : 'Perímetro'}
              </span>
            )}
            <span id="draw-message">
              {draftPoints.length
                ? `${draftPoints.length} puntos · ${num(polylineLength(draftPoints))} m`
                : 'Marca puntos en el plano'}
            </span>
            <button
              type="button"
              id="finish-draw"
              className="dark"
              disabled={draftPoints.length < (isPolygonTool ? 3 : 2)}
              onClick={finishDraw}
            >
              Terminar
            </button>
            <button
              type="button"
              id="cancel-draw"
              className="quiet"
              onClick={() => {
                setDraftPoints([]);
                if (!isOnboardingPerimeter) {
                  setTool('select');
                }
              }}
            >
              {isOnboardingPerimeter ? 'Reiniciar trazo' : 'Cancelar'}
            </button>
          </div>

          <div className="map-key">
            <span>
              <i className="key-boundary" />
              Ámbito de ensayo
            </span>
            <span style={{color: '#31572c'}}>● Satisfecho</span>
            <span style={{color: '#836718'}}>● Neutral</span>
            <span style={{color: '#aa3734'}}>● Descontento</span>
            <span>
              <i className="key-structure" />
              Propuesta
            </span>
            <span>
              <i className="key-route" />
              Recorrido
            </span>
          </div>

          <div className="map-zoom" role="group" aria-label="Zoom y vista">
            <button
              type="button"
              id="zoom-in"
              aria-label="Ampliar plano"
              onClick={() => zoom(0.8)}
            >
              +
            </button>
            <button
              type="button"
              id="zoom-out"
              aria-label="Alejar plano"
              onClick={() => zoom(1.25)}
            >
              −
            </button>
            <button
              type="button"
              id="fit"
              aria-label="Encuadrar recinto"
              onClick={fit}
            >
              ⛶
            </button>
          </div>

          <div className="scale">
            <div id="scale-line" ref={scaleLineRef} />
            <span id="scale-text" ref={scaleTextRef}>
              20 m
            </span>
          </div>
        </div>

        <div className="coordinate-bar">
          <span>
            <b id="cell" ref={cellSpanRef}>
              CELDA —
            </b>{' '}
            <span id="coords" ref={coordsSpanRef}>
              UTM 28N · EPSG:32628
            </span>
          </span>
          <span>
            Cuadrícula{' '}
            <b id="grid-readout">
              {gridVisible ? `${grid} × ${grid} m` : 'Oculta'}
            </b>
            <i>·</i> Norte arriba
          </span>
        </div>
      </>
    );
  }
);

MapShell.displayName = 'MapShell';
