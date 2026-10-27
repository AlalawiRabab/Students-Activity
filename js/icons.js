/**
 * icons.js — أيقونات SVG خطية بسيطة (بدون مكتبات خارجية)
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const ring = (cx, cy, r) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

const PATHS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M10 21v-6h4v6'],
  idcard: [
    'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    ring(9, 10, 2),
    'M14 9h4',
    'M14 13h4',
    'M6 16c.8-1.4 1.8-2 3-2s2.2.6 3 2',
  ],
  book: [
    'M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z',
    'M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3',
    'M8 7h8',
    'M8 11h6',
  ],
  calendar: ['M4 6h16v15H4z', 'M4 10h16', 'M8 3v5', 'M16 3v5', 'M8 14h2', 'M14 14h2', 'M8 17h2'],
  layers: ['M12 3 2.5 8 12 13l9.5-5z', 'M2.5 12.5 12 17.5l9.5-5', 'M2.5 16.5 12 21.5l9.5-5'],
  megaphone: [
    'M3 11v3a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z',
    'M17 9a4 4 0 0 1 0 6',
    'M19.5 6.5a8 8 0 0 1 0 11',
  ],
  clipboard: [
    'M9 3.5h6v3H9z',
    'M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3',
    'M8.5 11h7',
    'M8.5 15h5',
  ],
  chart: ['M4 20h16', 'M7 16v-5', 'M12 16V7', 'M17 16v-8'],
  users: [
    ring(9, 7.5, 3.5),
    'M2.5 20c.7-3.5 3.3-5.5 6.5-5.5s5.8 2 6.5 5.5',
    'M16 4.5a3.5 3.5 0 0 1 0 6.5',
    'M18 14.5c2 .6 3.2 2.5 3.5 5.5',
  ],
  presentation: [
    'M3 4h18',
    'M4.5 4v10a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V4',
    'M12 15v3',
    'M8 21l4-3 4 3',
    'M8 11l3-3 2 2 3-3',
  ],
  checklist: [
    'M10 6h10',
    'M10 12h10',
    'M10 18h10',
    'M3.5 6l1.5 1.5L7.5 5',
    'M3.5 12l1.5 1.5 2.5-2.5',
    'M3.5 18l1.5 1.5 2.5-2.5',
  ],
  message: [
    'M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4V6a2 2 0 0 1 1-2z',
    'M8.5 9h7',
    'M8.5 12.5h4.5',
  ],
  award: [ring(12, 9, 6), 'M8.5 13.8 7 22l5-3 5 3-1.5-8.2'],
  settings: [
    ring(12, 12, 3),
    'M12 2v3',
    'M12 19v3',
    'M2 12h3',
    'M19 12h3',
    'M4.9 4.9 7 7',
    'M17 17l2.1 2.1',
    'M4.9 19.1 7 17',
    'M17 7l2.1-2.1',
  ],
  archive: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', ring(12, 12, 3)],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  search: [ring(11, 11, 7), 'M20 20l-4-4'],
  file: ['M6 3h8l5 5v13H6z', 'M14 3v5h5'],
  image: ['M4 5h16v14H4z', ring(8.5, 9.5, 1.5), 'M20 15l-5-5L5 19'],
  external: [
    'M14 4h6v6',
    'M20 4l-9 9',
    'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  folder: ['M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  paperclip: [
    'M20.5 11.5 12.5 19.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10.2 17.2a1.7 1.7 0 0 1-2.4-2.4L15.5 7.1',
  ],
  logout: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h10'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  chevronRight: ['M9 6l6 6-6 6'],
  calendarSmall: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v5', 'M16 3v5'],
  target: [ring(12, 12, 8), ring(12, 12, 4), 'M12 12h.01'],
  info: [ring(12, 12, 9), 'M12 11v5', 'M12 8h.01'],
  printer: ['M7 9V3h10v6', 'M6 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2', 'M7 14h10v7H7z'],
};

/**
 * @param {string} name
 * @param {{ size?: number, className?: string }} [opts]
 * @returns {SVGSVGElement}
 */
export function icon(name, { size = 20, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  (PATHS[name] || PATHS.file).forEach((d) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  });
  return svg;
}
