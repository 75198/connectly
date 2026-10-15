// ===== Connectly branding: change name, logo and colours here only =====
export const brand = {
  name: 'Connectly',
  tagline: 'Stay close to the people who matter.',
  logoUrl: '/logo.svg',
  colors: {
    light: { primary: '#0F766E', primaryText: '#ffffff', accent: '#F59E0B', bg: '#F4F6F5', surface: '#ffffff', text: '#14201E', muted: '#5F6F6C', border: '#DDE4E2', danger: '#DC2626' },
    dark:  { primary: '#2DD4BF', primaryText: '#04201C', accent: '#FBBF24', bg: '#0B1211', surface: '#141D1C', text: '#E6EEEC', muted: '#93A4A0', border: '#24302E', danger: '#F87171' },
  },
  radius: '14px',
};
export type ThemeMode = 'light' | 'dark';
export function applyTheme(mode: ThemeMode) {
  const c = brand.colors[mode]; const s = document.documentElement.style;
  for (const [k, v] of Object.entries(c)) s.setProperty(`--${k}`, v);
  s.setProperty('--radius', brand.radius);
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', c.surface);
}
