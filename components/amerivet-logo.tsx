type AmeriVetLogoProps = {
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  variant?: 'mark' | 'wordmark';
};

const LOGO_SOURCES = {
  mark: {
    src: '/brand/amerivet-logo.png',
    aspectRatio: 259 / 129,
  },
  wordmark: {
    src: '/brand/amerivet-wordmark-logo.png',
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
      <img
        src={logo.src}
        alt={alt}
        width={normalizedWidth}
        height={safeHeight}
        className="block h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}
