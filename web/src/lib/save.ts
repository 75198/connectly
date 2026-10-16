// Save to gallery: fetch the watermarked HD copy from our server, then use the share sheet on phones
// (iPhone shows "Save Image" / "Save Video"), else download the file.
import { toast } from '../api';
export const canOfferSave = (p: { visibility: string; allow_downloads?: boolean | null; image_path?: string | null; video_path?: string | null; kind?: string }) =>
  p.visibility === 'public' && p.allow_downloads !== false && !!(p.image_path || p.video_path);
export async function saveToGallery(postId: number) {
  toast('Preparing your download…');
  try {
    const r = await fetch(`/api/posts/${postId}/download`, { credentials: 'same-origin' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || 'Couldn’t save this post.', 'err'); return; }
    const blob = await r.blob(); const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `connectly-${postId}`;
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e: any) { if (e?.name === 'AbortError') return; } }
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Saved');
  } catch { toast('Couldn’t save this post. Check your connection.', 'err'); }
}
