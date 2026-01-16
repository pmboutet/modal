interface LogoProps {
  className?: string;
}

/**
 * Logo component displaying "MODAL" text
 * Uses Saira Extra Condensed font (bold 700) in white
 */
export function Logo({ className = "" }: LogoProps) {
  return (
    <span
      className={`text-white font-bold tracking-tight ${className}`}
      style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
    >
      MODAL
    </span>
  );
}
