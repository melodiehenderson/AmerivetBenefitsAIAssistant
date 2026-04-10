import { ImageResponse } from 'next/og';

export const size = {
  width: 64,
  height: 64,
};

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
          background: '#1d4ed8',
          color: '#ffffff',
          fontSize: 34,
          fontWeight: 700,
          borderRadius: 14,
          letterSpacing: '-0.04em',
        }}
      >
        AV
      </div>
    ),
    size,
  );
}
