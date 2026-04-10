import { ImageResponse } from 'next/og';

export const size = {
  width: 1200,
  height: 600,
};

export const contentType = 'image/png';

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '48px 56px',
          background: '#0f172a',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            maxWidth: 760,
          }}
        >
          <div style={{ fontSize: 24, color: '#93c5fd', fontWeight: 600 }}>
            AmeriVet
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05 }}>
            Benefits Assistant
          </div>
          <div style={{ fontSize: 24, color: '#cbd5e1' }}>
            Personalized benefits guidance for AmeriVet employees.
          </div>
        </div>
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: 36,
            background: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 60,
            fontWeight: 800,
          }}
        >
          AV
        </div>
      </div>
    ),
    size,
  );
}
