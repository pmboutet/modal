interface LogoProps {
  className?: string;
  showTagline?: boolean;
}

/**
 * Logo component displaying "MODAL" text
 * Uses Saira Extra Condensed font (bold 700) in white
 */
export function Logo({ className = "", showTagline = false }: LogoProps) {
  return (
    <div className="inline-flex flex-col items-center">
      <span
        className={`text-white font-bold tracking-tight ${className}`}
        style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
      >
        MODAL
      </span>
      {showTagline && (
        <span
          className="text-white/80 text-sm tracking-[0.3em] uppercase mt-1"
          style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
        >
          Capture. Connect. Understand.
        </span>
      )}
    </div>
  );
}
