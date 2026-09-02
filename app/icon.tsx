import { ImageResponse } from 'next/og';

// Generated at build time, so there is no binary asset to keep in sync with the
// theme. Replaces the default Vercel triangle in the browser tab.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #9333ea 0%, #2563eb 55%, #0f1117 100%)',
          borderRadius: 7,
          color: '#fff',
          fontSize: 19,
          fontWeight: 800,
          letterSpacing: -1,
        }}
      >
        HL
      </div>
    ),
    size
  );
}
