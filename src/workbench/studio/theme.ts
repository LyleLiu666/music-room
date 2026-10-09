type Theme = 'light' | 'dark';
const storageKey = 'music-room-theme';
const system = matchMedia('(prefers-color-scheme: dark)');
let preference: Theme | undefined;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') preference = saved;
} catch {}

export function updateThemeControls() {
  const theme = preference ?? (system.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181d19' : '#f7f8f4');
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
