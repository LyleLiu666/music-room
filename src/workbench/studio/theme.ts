type Theme = 'light' | 'dark';
const storageKey = 'music-room-theme';
const system = matchMedia('(prefers-color-scheme: dark)');
let preference: Theme | undefined;
let switching: ReturnType<typeof setTimeout> | undefined;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') preference = saved;
} catch {}

export function updateThemeControls() {
  const theme = preference ?? (system.matches ? 'dark' : 'light');
  const root = document.documentElement;
  /* Palette flips instantly; mute transitions for a moment so no half-themed frame shows. */
  root.classList.add('theme-switching');
  clearTimeout(switching);
  switching = setTimeout(() => root.classList.remove('theme-switching'), 220);
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121613' : '#f4f5f1');
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  });
}

updateThemeControls();
system.addEventListener('change', () => { if (!preference) updateThemeControls(); });
document.addEventListener('click', event => {
  const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-theme-choice]')?.dataset.themeChoice;
  if (choice !== 'light' && choice !== 'dark') return;
  preference = choice;
  try { localStorage.setItem(storageKey, choice); } catch {}
  updateThemeControls();
});
