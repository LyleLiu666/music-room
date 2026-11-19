/** 16px 线性图标（1.5 描边，跟随文字颜色）。界面不再用 Unicode 字形充当图标。 */
const paths = {
  play: '<path d="M5 3.2v9.6c0 .4.4.6.7.4l7.4-4.8c.3-.2.3-.6 0-.8L5.7 2.8c-.3-.2-.7 0-.7.4Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="4" y="3" width="2.6" height="10" rx="1" fill="currentColor" stroke="none"/><rect x="9.4" y="3" width="2.6" height="10" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M4 3v10"/><path d="M12.5 3.5 6.5 8l6 4.5Z" fill="currentColor"/>',
  next: '<path d="M12 3v10"/><path d="M3.5 3.5 9.5 8l-6 4.5Z" fill="currentColor"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  more: '<circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  down: '<path d="m4 6 4 4 4-4"/>',
  up: '<path d="m4 10 4-4 4 4"/>',
  left: '<path d="m10 4-4 4 4 4"/>',
  right: '<path d="m6 4 4 4-4 4"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  external: '<path d="M6 3.5h6.5V10M12.5 3.5 4 12"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  note: '<path d="M6 12V3.5l7-1.5v8.5"/><circle cx="4.2" cy="12" r="1.8"/><circle cx="11.2" cy="10.5" r="1.8"/>',
  wave: '<path d="M2 7v2M5 4.5v7M8 2.5v11M11 5v6M14 7v2"/>',
  effect: '<path d="M2 5.5c2-2 4 2 6 0s4 2 6 0M2 10.5c2-2 4 2 6 0s4 2 6 0"/>',
  mic: '<rect x="5.5" y="1.8" width="5" height="8" rx="2.5"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5v2"/>',
  list: '<path d="M6 4h8M6 8h8M6 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  circle: '<circle cx="8" cy="8" r="5.5" stroke-dasharray="2.2 2.2"/>',
  undo: '<path d="M5.5 4 2.5 7l3 3"/><path d="M2.5 7h7a4 4 0 0 1 0 8H7"/>',
};

export type IconName = keyof typeof paths;

export function icon(name: IconName, size: 'md' | 'sm' = 'md') {
  return `<svg class="icon${size === 'sm' ? ' sm' : ''}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
