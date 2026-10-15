// ===== Connectly branding: change name, logo and colours here only =====
export const brand = {
  name: 'Connectly',
  tagline: 'Stay close to the people who matter.',
  logoUrl: '/logo.svg',
  colors: {
    light: { primary: '#0F766E', primaryText: '#ffffff', accent: '#F59E0B', bg: '#F4F6F5', surface: '#ffffff', text: '#14201E', muted: '#5F6F6C', border: '#DDE4E2', danger: '#DC2626', hover: 'rgba(20,32,30,.06)', hover2: 'rgba(20,32,30,.11)', soft: 'rgba(15,118,110,.14)', accentSoft: 'rgba(245,158,11,.15)' },
    dark:  { primary: '#2DD4BF', primaryText: '#04201C', accent: '#FBBF24', bg: '#0B1211', surface: '#141D1C', text: '#E6EEEC', muted: '#93A4A0', border: '#24302E', danger: '#F87171', hover: 'rgba(230,238,236,.07)', hover2: 'rgba(230,238,236,.13)', soft: 'rgba(45,212,191,.16)', accentSoft: 'rgba(251,191,36,.15)' },
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
