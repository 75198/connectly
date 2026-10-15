// Local currency on the client: region + daily rates from our server (detection happens privately on our server).
import { useEffect, useState } from 'react';
import { api, money } from '../api';
export type Region = { country: string; currency: string; source: string; currency_manual: boolean; rates: Record<string, number>; rates_updated: string | null };
export type Price = { amount: number; currency: string; exact: boolean };
let cache: Promise<Region> | null = null;
export function loadRegion(reset = false) {
  if (reset) cache = null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; const locale = navigator.language || '';
  return (cache ||= api<Region>(`/pricing/context?tz=${encodeURIComponent(tz)}&locale=${encodeURIComponent(locale)}`).catch((e) => { cache = null; throw e; }));
}
export function useRegion(on = true) { const [r, setR] = useState<Region | null>(null); useEffect(() => { if (on) loadRegion().then(setR).catch(() => {}); }, [on]); return r; }
export const showPrice = (p: Price) => (p.exact ? '' : '≈ ') + money(p.amount, p.currency);
export function approx(amount: number, from: string, r: Region | null) {
  if (!r || from === r.currency || !r.rates[from] || !r.rates[r.currency]) return null;
  const v = (amount / r.rates[from]) * r.rates[r.currency]; const mag = v >= 100 ? 10 ** (Math.floor(Math.log10(v)) - 1) : 1;
  return '≈ ' + money(v >= 100 ? Math.round(v / mag) * mag : Math.round(v), r.currency);
}
export const regionName = (cc: string) => { try { return new Intl.DisplayNames([navigator.language], { type: 'region' }).of(cc) || cc; } catch { return cc; } };
export const currencyName = (c: string) => { try { return new Intl.DisplayNames([navigator.language], { type: 'currency' }).of(c) || c; } catch { return c; } };
