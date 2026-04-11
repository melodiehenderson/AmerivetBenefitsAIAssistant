type AmeriVetLogoProps = {
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
};

const LOGO_ASPECT_RATIO = 259 / 129;

function joinClasses(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function BrandMark({ size }: { size: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-white shadow-sm"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="absolute left-[18%] top-[18%] h-[18%] w-[56%] rounded-full bg-red-500"
      />
      <span
        className="absolute left-[18%] top-[42%] h-[10%] w-[64%] rounded-full bg-blue-600"
      />
      <span
        className="absolute left-[18%] top-[58%] h-[10%] w-[44%] rounded-full bg-sky-400"
      />
    </span>
  );
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
  const compact = normalizedWidth < 72;
  const markSize = compact ? Math.max(24, safeHeight) : Math.max(24, Math.round(safeHeight * 0.82));
  const wordmarkSize = Math.max(16, Math.round(safeHeight * 0.42));

  return (
    <span
      className={joinClasses('inline-flex items-center justify-start overflow-hidden', className)}
      style={{ width: normalizedWidth, height: safeHeight }}
      aria-label={alt}
      title={alt}
    >
      {compact ? (
        <BrandMark size={markSize} />
      ) : (
        <span className="inline-flex items-center gap-2 text-slate-900">
          <BrandMark size={markSize} />
          <span
            className="whitespace-nowrap font-semibold tracking-tight"
            style={{ fontSize: wordmarkSize, lineHeight: 1 }}
          >
            AmeriVet
          </span>
        </span>
      )}
    </span>
  );
}
