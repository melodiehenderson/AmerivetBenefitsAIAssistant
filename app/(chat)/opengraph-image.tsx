import { ImageResponse } from 'next/og';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 64px',
          background:
            'linear-gradient(135deg, #eff6ff 0%, #dbeafe 42%, #c7d2fe 100%)',
          color: '#0f172a',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              background: '#1d4ed8',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            AV
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 28, color: '#1e3a8a', fontWeight: 600 }}>
              AmeriVet
            </div>
            <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>
              Benefits Assistant
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontSize: 30, color: '#334155' }}>
            Compare plans, understand coverage, and get enrollment guidance.
          </div>
          <div style={{ fontSize: 22, color: '#475569' }}>
            Built for AmeriVet employees.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
