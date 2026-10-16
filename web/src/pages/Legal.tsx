import { Link } from 'react-router-dom';
import { brand } from '../brand';
import { Logo } from '../components/ui';

const Wrap = ({ title, children }: { title: string; children: React.ReactNode }) =>
  <div className="legal"><p><Link to="/"><Logo size={30} /></Link></p><h1>{title}</h1><p className="meta">Last updated: 16 October 2026</p><p className="notice">Template: this document must be reviewed by a qualified lawyer before Connectly is published in the App Store or Google Play.</p>{children}
    <hr /><p className="meta"><Link to="/terms">Terms &amp; Conditions</Link> · <Link to="/privacy">Privacy Policy</Link></p></div>;

export function Terms() {
  const n = brand.name;
  return <Wrap title="Terms & Conditions">
    <p>Welcome to {n}. By creating an account or using {n} you agree to these terms. Please read them carefully.</p>
    <h2>1. Who can use {n}</h2><p>You must be at least 13 years old. You must give accurate information when you sign up, including your real name and date of birth, and keep your login details private. One person, one personal account.</p>
    <h2>2. Your content</h2><p>You own the posts, photos and comments you share. By posting, you give {n} a non-exclusive, royalty-free licence to host, store, display and resize that content so we can show it to the audience you choose (Public, Friends or Only me). You can delete your content at any time.</p>
    <h2>3. What isn’t allowed</h2><ul><li>Harassment, bullying, threats, hate speech or incitement to violence.</li><li>Nudity or sexual content involving minors — we report this to the authorities.</li><li>Scams, spam, impersonation, fake accounts or selling accounts.</li><li>Sharing other people’s private information without consent.</li><li>Content that infringes someone else’s copyright or trademark.</li><li>Attempting to hack, overload or scrape the service.</li></ul>
    <h2>4. Enforcement</h2><p>We may remove content or suspend accounts that break these terms or the law. Where we can, we’ll tell you why.</p>
    <h2>5. The service</h2><p>{n} is provided “as is”. We work hard to keep it secure and available but can’t promise it will always be error-free or uninterrupted. Features may change as we improve the product.</p>
    <h2>6. Liability</h2><p>To the extent permitted by law, {n} is not liable for indirect or consequential losses, or for content posted by other users.</p>
    <h2>7. Ending your account</h2><p>You can stop using {n} at any time. We may close accounts that are inactive for a long period or that break these terms.</p>
    <h2>8. Changes</h2><p>If we make significant changes to these terms we’ll let you know in the app before they take effect.</p>
    <h2>9. Governing law</h2><p>These terms are governed by the laws of [jurisdiction to be confirmed by legal review].</p>
  </Wrap>;
}
export function Privacy() {
  const n = brand.name;
  return <Wrap title="Privacy Policy">
    <p>This policy explains what {n} collects, why, and the choices you have.</p>
    <h2>What we collect</h2><ul><li><b>Account details:</b> your email or phone number, full name, date of birth and a securely hashed password.</li><li><b>Content:</b> posts, photos, comments, likes, your bio and location if you add them.</li><li><b>Technical data:</b> session cookies to keep you signed in and basic server logs used for security.</li></ul>
    <h2>What we don’t collect</h2><ul><li>Your exact GPS position. If you allow location, it’s converted to a city and country and the coordinates are thrown away.</li><li>Your address book. If you choose contacts, they’re hashed on your device and only used once to find people you know who already use {n}; nothing is stored.</li><li>Photo metadata. Uploaded photos are re-processed, which removes hidden data such as GPS tags.</li></ul>
    <h2>How we use it</h2><p>To run your account, show your content to the audience you choose, keep {n} safe (including rate-limiting and abuse prevention) and send you security codes. We don’t sell your personal data and we don’t show third-party ads.</p>
    <h2>Who can see what</h2><p>Your name, @username, profile photo, cover, bio and location are visible to signed-in users. Each post is visible according to the audience you pick. Your email, phone number and date of birth are never shown to other users.</p>
    <h2>Service providers</h2><p>We use an email delivery provider to send verification and reset codes, and OpenStreetMap’s geocoder to turn location into a city name.</p>
    <h2>Your choices</h2><p>You can edit your profile, delete posts and comments, and turn off notifications or location in your browser settings at any time. To delete your account or request a copy of your data, contact the {n} team.</p>
    <h2>Security</h2><p>Passwords are hashed with bcrypt, codes are hashed and expire after 10 minutes, and all traffic is encrypted with HTTPS.</p>
    <h2>Children</h2><p>{n} is not for children under 13. If we learn an account belongs to someone under 13 we will remove it.</p>
    <h2>Teens</h2><p>Accounts for people under 18 start private, and adults they don’t follow can’t message them.</p>
    <h2>Connectly AI and translation</h2><p>When you use Connectly AI, translation or voice input, the text, photo or audio you send is processed by our AI provider (Groq) to produce the answer, and it isn’t used to build advertising profiles. Your country is worked out on our own servers; we never send your IP address to third parties.</p>
    <h2>Your rights: access and deletion</h2><p>Download a copy of your data any time from Settings › Safety Center › Download your data. You can delete your account from Settings: it is hidden right away and permanently deleted after 30 days, unless you log in again before then. Backups are kept encrypted for a limited time and then removed.</p>
    <h2>Payments</h2><p>Coins can be used for tips and gifts. In the iPhone and Android apps, any purchases go through Apple or Google, and their terms apply.</p>
    <h2>Contact</h2><p>Questions about privacy? Use Settings › Help or the in-app report tools, and we’ll reply.</p>
  </Wrap>;
}

