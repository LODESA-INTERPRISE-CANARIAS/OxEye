/**
 * @module engine/cartography/object-skin
 * Decorative top-down plan symbols for booths and infrastructure; geometry and simulation dimensions stay unchanged.
 */

export function objectSkin(
  o: {kind?: string; type?: string; role?: string},
  w: number,
  h: number
): string {
  const kind = o.kind || o.type;
  const stroke = '#294c50';
  const line = (x1: number, y1: number, x2: number, y2: number): string =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width=".18"/>`;
  let content = '';
  if (kind === 'food' || kind === 'foodtruck') {
    content =
      `<rect x="${-w * 0.44}" y="${-h * 0.4}" width="${w * 0.2}" height="${
        h * 0.8
      }" rx=".2" fill="#d9ece9"/>` +
      [-1, 1]
        .map((a) =>
          [-1, 1]
            .map(
              (b) =>
                `<rect x="${a * w * 0.3 - 0.3}" y="${
                  b * h * 0.5 - 0.12
                }" width=".6" height=".24" rx=".1" fill="#243a40"/>`
            )
            .join('')
        )
        .join('') +
      line(-w * 0.12, h * 0.47, w * 0.4, h * 0.47);
  } else if (kind === 'picnic') {
    content =
      `<rect x="${-w * 0.45}" y="${-h * 0.24}" width="${w * 0.9}" height="${
        h * 0.48
      }" rx=".1" fill="#d2b18a" stroke="${stroke}" stroke-width=".1"/>` +
      [-1, 1]
        .map(
          (b) =>
            `<rect x="${-w * 0.45}" y="${
              b * h * 0.38 - h * 0.06
            }" width="${w * 0.9}" height="${h * 0.12}" fill="#9a7855"/>`
        )
        .join('');
  } else if (o.role === 'cover') {
    content =
      line(-w / 2, -h / 2, 0, 0) +
      line(w / 2, -h / 2, 0, 0) +
      line(w / 2, h / 2, 0, 0) +
      line(-w / 2, h / 2, 0, 0) +
      [-1, 1]
        .map((a) =>
          [-1, 1]
            .map(
              (b) =>
                `<circle cx="${a * w * 0.47}" cy="${
                  b * h * 0.47
                }" r=".18" fill="${stroke}"/>`
            )
            .join('')
        )
        .join('');
  } else if (kind === 'stage') {
    content =
      `<rect x="${-w * 0.45}" y="${h * 0.3}" width="${w * 0.9}" height="${
        h * 0.12
      }" fill="#2c4a54"/>` +
      [-1, 1]
        .map(
          (a) =>
            `<rect x="${a * w * 0.38 - 0.3}" y="${
              -h * 0.35
            }" width=".6" height="${h * 0.55}" fill="#344751"/>`
        )
        .join('');
  } else if (kind === 'toilet') {
    content =
      line(0, -h / 2, 0, h / 2) +
      `<text x="0" y="${h * 0.15}" text-anchor="middle" font-size="${
        Math.min(w, h) * 0.35
      }" fill="${stroke}">WC</text>`;
  } else if (kind === 'medical') {
    content =
      '<path d="M-.25 -1H.25V-.25H1V.25H.25V1H-.25V.25H-1V-.25H-.25Z" fill="#fff"/>';
  } else if (
    o.type === 'commerce' ||
    o.type === 'workshop' ||
    kind === 'ventorrillo'
  ) {
    content =
      `<rect x="${-w * 0.46}" y="${h * 0.28}" width="${w * 0.92}" height="${
        h * 0.15
      }" fill="#fff7dd" stroke="${stroke}" stroke-width=".12"/>` +
      line(-w * 0.4, -h * 0.4, w * 0.4, -h * 0.4);
  }
  return `<g pointer-events="none" class="object-skin">${content}</g>`;
}
