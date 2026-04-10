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
          alignItems: 'stretch',
          background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 44%, #bfdbfe 100%)',
          color: '#0f172a',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div
          style={{
            width: 420,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '48px 40px',
            background: '#0f172a',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
              color: '#1d4ed8',
              fontSize: 36,
              fontWeight: 800,
            }}
          >
            AV
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 22, opacity: 0.8 }}>AmeriVet</div>
            <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.08 }}>
              Benefits AI Assistant
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '48px 56px',
            gap: 22,
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.08 }}>
            Answers for plans, costs, enrollment, and leave.
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.35, color: '#1e3a8a' }}>
            Hybrid deterministic plus grounded retrieval with tighter source-of-truth controls.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
