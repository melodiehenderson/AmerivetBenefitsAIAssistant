type AmeriVetLogoProps = {
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  variant?: 'full' | 'mark';
};

const AMERIVET_LOGO_SRC = '/brand/amerivet-logo.png';
const LOGO_ASPECT_RATIO = 259 / 129;
const MARK_FRAME_ASPECT_RATIO = 1;

function joinClasses(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function AmeriVetLogo({
  alt = 'AmeriVet',
  width = 40,
  height,
  className,
  variant = 'full',
}: AmeriVetLogoProps) {
  const aspectRatio = variant === 'mark' ? MARK_FRAME_ASPECT_RATIO : LOGO_ASPECT_RATIO;
  const safeHeight = height ?? Math.round(width / aspectRatio);
  const normalizedWidth =
    width === safeHeight ? Math.round(safeHeight * aspectRatio) : width;

  return (
    <span
      className={joinClasses('inline-flex items-center justify-center overflow-hidden', className)}
      style={{ width: normalizedWidth, height: safeHeight }}
      aria-label={alt}
      title={alt}
    >
      <img
        src={AMERIVET_LOGO_SRC}
        alt={alt}
        width={variant === 'mark' ? Math.round(safeHeight * LOGO_ASPECT_RATIO) : normalizedWidth}
        height={safeHeight}
        className={joinClasses(
          'block h-full',
          variant === 'mark' ? 'max-w-none object-cover object-left' : 'w-full object-contain',
        )}
        draggable={false}
      />
    </span>
  );
}
