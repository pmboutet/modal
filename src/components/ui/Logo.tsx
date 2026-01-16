interface LogoProps {
  className?: string;
  textClassName?: string;
  taglineClassName?: string;
  showTagline?: boolean;
}

/**
 * Logo component displaying "MODAL" text
 * Uses Saira Extra Condensed font (bold 700) in white
 */
export function Logo({
  className = "",
  textClassName = "text-[10rem] leading-none",
  taglineClassName = "text-[1.15rem] tracking-[0.3em] -mt-[1.5rem] pl-[0.39em]",
  showTagline = false
}: LogoProps) {
  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <span
        className={`text-white font-bold ${textClassName}`}
        style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
      >
        MODAL
      </span>
      {showTagline && (
        <span
          className={`text-white/80 uppercase text-center ${taglineClassName}`}
          style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
        >
          Capture. Connect. Understand.
        </span>
      )}
    </div>
  );
}
