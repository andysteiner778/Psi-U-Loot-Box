import { ImageResponse } from 'next/og';

/**
 * Tab icon: the chapter's Greek letters over a loot-case silhouette.
 *
 * Generated at build time rather than shipped as a binary, so it stays in sync
 * with the theme and there is no asset to lose.
 */
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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(150deg, #a855f7 0%, #6366f1 45%, #1e293b 100%)',
          borderRadius: 7,
          color: '#fff',
          position: 'relative',
        }}
      >
        {/* Case lid */}
        <div
          style={{
            width: 22,
            height: 5,
            background: '#eab308',
            borderRadius: '3px 3px 0 0',
            marginBottom: 1,
          }}
        />
        {/* Greek letters, the chapter's own */}
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: -1,
            display: 'flex',
          }}
        >
          ΨΥ
        </div>
      </div>
    ),
    size
  );
}
