type AmeriVetLogoProps = {
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
};

const AMERIVET_LOGO_SRC = '/brand/amerivet-logo.png';

const LOGO_ASPECT_RATIO = 259 / 129;

function joinClasses(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function AmeriVetLogo({
  alt = 'AmeriVet',
  width = 128,
  height,
  className,
}: AmeriVetLogoProps) {
  const safeHeight = height ?? Math.round(width / LOGO_ASPECT_RATIO);
  const normalizedWidth =
    width === safeHeight ? Math.round(safeHeight * LOGO_ASPECT_RATIO) : width;

  return (
    <span
      className={joinClasses('inline-flex items-center justify-start overflow-hidden', className)}
      style={{ width: normalizedWidth, height: safeHeight }}
      aria-label={alt}
    >
      <img
        src={AMERIVET_LOGO_SRC}
        alt={alt}
        width={normalizedWidth}
        height={safeHeight}
        className="block h-[150%] w-[150%] max-w-none object-contain object-left"
        style={{ transform: 'translateX(-12%) translateY(-2%)' }}
        draggable={false}
      />
    </span>
  );
}
