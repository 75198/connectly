import { useEffect, useState } from 'react';
import { looksLikePhone } from '../api';

type Country = { code: string; dial: string; name: string };
let cache: Country[] | null = null;
// Country list is loaded lazily (only when the user types a phone number) to keep the first load small.
async function loadCountries(): Promise<Country[]> {
  if (cache) return cache;
  const { getCountries, getCountryCallingCode } = await import('libphonenumber-js/min');
  let names: { of(c: string): string | undefined } | null = null;
  try { names = new (Intl as any).DisplayNames(['en'], { type: 'region' }); } catch { /* old browser */ }
  cache = getCountries().map((c) => ({ code: c, dial: getCountryCallingCode(c), name: names?.of(c) || c })).sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function IdentifierInput({ value, onChange, country, onCountry, autoFocus }: { value: string; onChange: (v: string) => void; country: string; onCountry: (c: string) => void; autoFocus?: boolean }) {
  const phone = looksLikePhone(value);
  const [list, setList] = useState<Country[] | null>(cache);
  useEffect(() => { if (phone && !list) loadCountries().then(setList).catch(() => setList([{ code: 'US', dial: '1', name: 'United States' }])); }, [phone, list]);
  return <label>Email or phone number
    <div className="phonerow">
      {phone && <select aria-label="Country code" value={country} onChange={(e) => onCountry(e.target.value)}>
        {(list || [{ code: 'US', dial: '1', name: 'United States' }]).map((c) => <option key={c.code} value={c.code}>{c.name} +{c.dial}</option>)}
      </select>}
      <input value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} required autoCapitalize="none" autoCorrect="off" spellCheck={false}
        inputMode={phone ? 'tel' : 'email'} autoComplete="username" maxLength={200} />
    </div>
  </label>;
}
