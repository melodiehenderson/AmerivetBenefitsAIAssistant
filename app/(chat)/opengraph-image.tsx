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
          padding: '56px',
          background:
            'radial-gradient(circle at top right, #60a5fa 0%, rgba(96,165,250,0.18) 28%, transparent 42%), linear-gradient(135deg, #0f172a 0%, #111827 45%, #1d4ed8 100%)',
          color: '#ffffff',
          fontFamily: 'Arial, sans-serif',
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
              width: 90,
              height: 90,
              borderRadius: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
              color: '#1d4ed8',
              fontSize: 40,
              fontWeight: 800,
            }}
          >
            AV
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 22, opacity: 0.8 }}>AmeriVet</div>
            <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05 }}>
              Benefits AI Assistant
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            maxWidth: 860,
          }}
        >
          <div style={{ fontSize: 30, lineHeight: 1.35, opacity: 0.92 }}>
            Practical, policy-aware answers for plans, enrollment, leave, and support.
          </div>
          <div style={{ fontSize: 24, color: '#bfdbfe' }}>
            Grounded guidance for AmeriVet employees
          </div>
        </div>
      </div>
    ),
    size,
  );
}
