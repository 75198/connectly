import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { brand } from '../brand';
import { getFeatures } from '../api';

// Logged-out landing screen. Background video is tiny (~200 KB), muted, and skipped entirely for
// reduced-motion or data-saver users (the poster image is shown instead).
export function Hero() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => { getFeatures().then((f) => setEnabled(f.welcome_hero)); }, []);
  const still = typeof matchMedia !== 'undefined' && (matchMedia('(prefers-reduced-motion: reduce)').matches || !!(navigator as any).connection?.saveData);
  const wide = typeof matchMedia !== 'undefined' && matchMedia('(min-aspect-ratio: 1/1)').matches;
  const src = wide ? '/media/hero-wide' : '/media/hero';
  if (enabled === false) return <Navigate to="/login" replace />;
  return <div className="hero">
    {still ? <img className="herovid" src={`${src}-poster.jpg`} alt="" />
      : <video className="herovid" src={`${src}.mp4`} poster={`${src}-poster.jpg`} autoPlay muted loop playsInline preload="auto" aria-hidden />}
    <div className="heroshade" />
    <div className="herobody">
      <img className="herologo" src={brand.logoUrl} width={72} height={72} alt="" />
      <h1 className="herotitle"><span>{brand.name}</span></h1>
      <p className="herotag">Your people, your moments,<br />all in one place.</p>
      <ul className="herochips" aria-label="What you can do">
        <li>Share posts</li><li>Watch reels</li><li>Buy &amp; sell</li><li>Join groups</li>
      </ul>
      <div className="herocta">
        <Link className="btn primary block herobtn" to="/signup">Create account</Link>
        <Link className="btn block heroghost" to="/login">Log in</Link>
      </div>
    </div>
  </div>;
}
