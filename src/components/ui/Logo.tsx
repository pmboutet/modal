interface LogoProps {
  className?: string;
  textClassName?: string;
  taglineClassName?: string;
  showTagline?: boolean;
  animated?: boolean;
  /** Alignment of text content: 'center' (default) or 'start' for left-aligned */
  align?: 'center' | 'start';
}

/**
 * Logo component displaying "MODAL" text
 * Uses Saira Extra Condensed font (bold 700)
 * Supports static white or animated aurora gradient
 */
export function Logo({
  className = "",
  textClassName = "text-[10rem] leading-none",
  taglineClassName = "text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.6em]",
  showTagline = false,
  animated = false,
  align = 'center'
}: LogoProps) {
  const alignmentClass = align === 'start' ? 'items-start' : 'items-center';
  return (
    <div className={`inline-flex flex-col ${alignmentClass} ${className}`}>
      <span
        className={`font-bold ${animated ? "bg-clip-text text-transparent animate-aurora-text" : "text-white"} ${textClassName}`}
        style={{
          fontFamily: "'Saira Extra Condensed', sans-serif",
          ...(animated && {
            backgroundImage: "linear-gradient(135deg, #0d9488 0%, #c026d3 25%, #f472b6 50%, #0891b2 75%, #0d9488 100%)",
            backgroundSize: "300% 300%",
          }),
        }}
      >
        MODAL
      </span>
      {showTagline && (
        <span
          className={`uppercase ${align === 'start' ? 'text-left' : 'text-center'} ${animated ? "bg-clip-text text-transparent animate-aurora-text" : "text-white/80"} ${taglineClassName}`}
          style={{
            fontFamily: "'Saira Extra Condensed', sans-serif",
            ...(animated && {
              backgroundImage: "linear-gradient(135deg, #0d9488 0%, #c026d3 25%, #f472b6 50%, #0891b2 75%, #0d9488 100%)",
              backgroundSize: "300% 300%",
            }),
          }}
        >
          Capture. Connect. Understand.
        </span>
      )}
    </div>
  );
}
