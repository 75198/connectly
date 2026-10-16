import { useEffect, useState } from 'react';
import { api, toast } from '../api';
import { loadRegion, regionName, currencyName, type Region } from '../lib/region';
const COUNTRIES = ['NG', 'GH', 'KE', 'ZA', 'EG', 'MA', 'TZ', 'UG', 'RW', 'ET', 'CM', 'SN', 'CI', 'US', 'CA', 'MX', 'BR', 'GB', 'IE', 'FR', 'DE', 'ES', 'IT', 'NL', 'PT', 'CH', 'SE', 'PL', 'TR', 'AE', 'SA', 'IN', 'PK', 'BD', 'CN', 'JP', 'KR', 'SG', 'ID', 'PH', 'AU', 'NZ'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'BRL', 'MXN', 'NGN', 'GHS', 'KES', 'ZAR', 'EGP', 'XOF', 'XAF', 'CHF', 'AED', 'SAR', 'INR', 'PKR'];
const SRC: Record<string, string> = { manual: 'Chosen by you', network: 'Detected privately on our servers', timezone: 'From your device time zone', language: 'From your device language', default: 'Not detected' };

export function RegionSection() {
  const [r, setR] = useState<Region | null>(null); const [manualCountry, setMC] = useState(false);
  useEffect(() => { loadRegion(true).then((x) => { setR(x); setMC(x.source === 'manual'); }).catch(() => {}); }, []);
  const save = async (json: object) => { try { await api('/me/region', { method: 'PATCH', json }); setR(await loadRegion(true)); toast('Saved'); } catch (e: any) { toast(e.message, 'err'); } };
  if (!r) return <p className="meta">Loading…</p>;
  const list = [...new Set([r.country, ...COUNTRIES])].map((c) => [c, regionName(c)] as const).sort((a, b) => a[1].localeCompare(b[1]));
  return <div className="stack">
    <section className="card stack"><h3>Country or region</h3>
      <select aria-label="Country or region" value={manualCountry ? r.country : ''} onChange={(e) => { setMC(!!e.target.value); save({ country: e.target.value || null }); }}>
        <option value="">Automatic · {regionName(r.country)}</option>{list.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      <small className="meta">{SRC[r.source]}. We never send your IP address to anyone else. Your region also lightly shapes local news.</small></section>
    <section className="card stack"><h3>Currency</h3>
      <select aria-label="Currency" value={r.currency_manual ? r.currency : ''} onChange={(e) => save({ currency: e.target.value || null })}>
        <option value="">Automatic · {currencyName(r.currency)}</option>{[...new Set([r.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{currencyName(c)} ({c})</option>)}</select>
      <small className="meta">Prices for plans and coins show in this currency. Marketplace items show the seller’s price with an approximate conversion. Rates update daily.</small></section>
  </div>;
}
