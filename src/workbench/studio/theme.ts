import {icon} from './icons.ts';
type Theme = 'light' | 'dark';
type Preference = Theme | 'system';
const storageKey = 'music-room-theme';
const system = matchMedia('(prefers-color-scheme: dark)');
let preference: Preference = 'system';
let switching: ReturnType<typeof setTimeout> | undefined;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved;
} catch {}

const effective = (): Theme => preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;

/** 侧栏底部：日间 / 夜间两枚图标按钮，按当前实际主题高亮。 */
export function themeToggle() {
  return `<div class="theme-switch compact" role="group" aria-label="界面主题"><button type="button" data-theme-choice="light" aria-label="日间" title="日间" aria-pressed="false">${icon('sun')}</button><button type="button" data-theme-choice="dark" aria-label="夜间" title="夜间" aria-pressed="false">${icon('moon')}</button></div>`;
}

/** 设置 · 外观：日间 / 夜间 / 跟随系统，按用户选择高亮。 */
export function themeSettings() {
  return `<div class="theme-switch" role="group" aria-label="界面主题" data-theme-preference><button type="button" data-theme-choice="light" aria-pressed="false">日间</button><button type="button" data-theme-choice="dark" aria-pressed="false">夜间</button><button type="button" data-theme-choice="system" aria-pressed="false">跟随系统</button></div>`;
}

export function updateThemeControls() {
  const theme = effective();
  const root = document.documentElement;
  /* Palette flips instantly; mute transitions for a moment so no half-themed frame shows. */
  root.classList.add('theme-switching');
  clearTimeout(switching);
  switching = setTimeout(() => root.classList.remove('theme-switching'), 220);
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1b1a17' : '#f5f2ea');
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button => {
    const settings = !!button.closest('[data-theme-preference]');
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (settings ? preference : theme)));
  });
}

updateThemeControls();
system.addEventListener('change', () => { if (preference === 'system') updateThemeControls(); });
document.addEventListener('click', event => {
  const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-theme-choice]')?.dataset.themeChoice;
  if (choice !== 'light' && choice !== 'dark' && choice !== 'system') return;
  preference = choice;
  try { localStorage.setItem(storageKey, choice); } catch {}
  updateThemeControls();
});
