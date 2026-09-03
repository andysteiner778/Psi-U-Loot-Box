import type { BoxTier } from '@/lib/types';

/**
 * Case artwork.
 *
 * All three boxes shared one generic Lucide package icon in the accent colour,
 * so the only thing distinguishing a $5 crate from a $50 one was a hue. These
 * are drawn as inline SVG — no image requests on a night when thirty phones
 * share one connection — and each tier reads differently at a glance:
 *
 *   Tier 1  a battered cardboard box, flaps open, tape peeling
 *   Tier 2  a latched wooden crate with metal banding
 *   Tier 3  an armoured flight case, rivets and a glowing seam
 */
export function CaseArt({ tier, color }: { tier: BoxTier; color: string }) {
  const glow = { filter: `drop-shadow(0 0 14px ${color}90)` };

  if (tier === 'tier_1') {
    return (
      <svg viewBox="0 0 120 100" className="h-28 w-28" style={glow} aria-hidden>
        {/* open flaps */}
        <path d="M18 34 L34 20 L60 30 L44 44 Z" fill={color} opacity="0.35" />
        <path d="M102 34 L86 20 L60 30 L76 44 Z" fill={color} opacity="0.25" />
        {/* body */}
        <path d="M20 36 L60 30 L100 36 L100 82 L60 92 L20 82 Z" fill={color} opacity="0.55" />
        <path d="M60 30 L60 92" stroke="#0f1117" strokeWidth="2" opacity="0.5" />
        {/* peeling tape */}
        <path d="M52 32 L68 34 L68 90 L52 88 Z" fill="#e8ebf2" opacity="0.16" />
        <path d="M20 82 L60 92 L100 82" fill="none" stroke={color} strokeWidth="2" opacity="0.9" />
      </svg>
    );
  }

  if (tier === 'tier_2') {
    return (
      <svg viewBox="0 0 120 100" className="h-28 w-28" style={glow} aria-hidden>
        {/* lid */}
        <path d="M16 30 L60 18 L104 30 L104 40 L60 30 L16 40 Z" fill={color} opacity="0.75" />
        {/* body */}
        <path d="M16 40 L60 30 L104 40 L104 84 L60 94 L16 84 Z" fill={color} opacity="0.5" />
        {/* plank seams */}
        <path d="M32 36 L32 86 M60 30 L60 94 M88 36 L88 86" stroke="#0f1117" strokeWidth="1.6" opacity="0.45" />
        {/* metal banding */}
        <path d="M16 56 L60 66 L104 56" fill="none" stroke="#e8ebf2" strokeWidth="2.5" opacity="0.28" />
        {/* latch */}
        <rect x="54" y="30" width="12" height="14" rx="2" fill="#e8ebf2" opacity="0.55" />
      </svg>
    );
  }

  // tier_3
  return (
    <svg viewBox="0 0 120 100" className="h-28 w-28" style={glow} aria-hidden>
      <defs>
        <linearGradient id="seam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="50%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* lid */}
      <path d="M14 28 L60 16 L106 28 L106 42 L60 32 L14 42 Z" fill={color} opacity="0.8" />
      {/* body */}
      <path d="M14 42 L60 32 L106 42 L106 84 L60 96 L14 84 Z" fill={color} opacity="0.45" />
      {/* corner armour */}
      <path d="M14 42 L26 39 L26 82 L14 84 Z M106 42 L94 39 L94 82 L106 84 Z" fill="#e8ebf2" opacity="0.2" />
      {/* rivets */}
      {[46, 58, 70].map((y) => (
        <g key={y}>
          <circle cx="20" cy={y} r="2" fill="#e8ebf2" opacity="0.55" />
          <circle cx="100" cy={y} r="2" fill="#e8ebf2" opacity="0.55" />
        </g>
      ))}
      {/* glowing seam where the lid meets the body */}
      <path d="M14 42 L60 32 L106 42" fill="none" stroke="url(#seam)" strokeWidth="3" />
      {/* clasp */}
      <rect x="52" y="32" width="16" height="16" rx="3" fill="#e8ebf2" opacity="0.6" />
      <rect x="57" y="37" width="6" height="6" rx="1" fill={color} />
    </svg>
  );
}
