import Image from 'next/image';

type AmeriVetLogoProps = {
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  variant?: 'mark' | 'wordmark';
};

import amerivetMark from '@/public/brand/amerivet-logo.png';
import amerivetWordmark from '@/public/brand/amerivet-wordmark-logo.png';

const LOGO_SOURCES = {
  mark: {
    src: amerivetMark,
    aspectRatio: 259 / 129,
  },
  wordmark: {
    src: amerivetWordmark,
    aspectRatio: 1000 / 300,
  },
} as const;

function joinClasses(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function AmeriVetLogo({
  alt = 'AmeriVet',
  width = 40,
  height,
  className,
  variant = 'mark',
}: AmeriVetLogoProps) {
  const logo = LOGO_SOURCES[variant];
  const safeHeight = height ?? Math.round(width / logo.aspectRatio);
  const normalizedWidth =
    width === safeHeight ? Math.round(safeHeight * logo.aspectRatio) : width;

  return (
    <span
      className={joinClasses('inline-flex items-center justify-center overflow-hidden', className)}
      style={{ width: normalizedWidth, height: safeHeight }}
      aria-label={alt}
      title={alt}
    >
      <Image
        src={logo.src}
        alt={alt}
        width={normalizedWidth}
        height={safeHeight}
        className="block h-full w-full object-contain"
        draggable={false}
        priority={priority}
      />
    </span>
  );
}
