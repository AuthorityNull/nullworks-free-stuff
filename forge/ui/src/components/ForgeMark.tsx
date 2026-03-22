import React from 'react';

interface ForgeMarkProps {
  size?: number;
  className?: string;
}

/**
 * ForgeMark - Geometric anvil-derived mark
 * 
 * Design rationale:
 * - Anvil shape abstracted into clean geometric forms
 * - Top horizontal bar = anvil face
 * - Middle taper = anvil body
 * - Bottom base = foundation
 * - Red accent = forge heat/spark
 * 
 * This avoids the cheesy literal hammer while maintaining
 * the industrial/brutalist aesthetic appropriate for Forge.
 */
const ForgeMark: React.FC<ForgeMarkProps> = ({ size = 20, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Anvil face - top horizontal bar */}
      <rect x="4" y="6" width="56" height="10" fill="currentColor" />
      
      {/* Anvil body - tapered form */}
      <path
        d="M12 16L16 32H48L52 16H12Z"
        fill="currentColor"
      />
      
      {/* Anvil base - foundation block */}
      <rect x="14" y="32" width="36" height="8" fill="currentColor" />
      
      {/* Base extension */}
      <rect x="10" y="40" width="44" height="6" fill="currentColor" />
      
      {/* Bottom footing */}
      <rect x="6" y="46" width="52" height="8" fill="currentColor" />
      
      {/* Forge heat accent - the spark/fire */}
      <rect x="24" y="20" width="16" height="8" fill="var(--color-accent, #BC0D13)" />
      
      {/* Small spark detail */}
      <rect x="28" y="14" width="8" height="4" fill="var(--color-accent, #BC0D13)" />
    </svg>
  );
};

export default ForgeMark;
