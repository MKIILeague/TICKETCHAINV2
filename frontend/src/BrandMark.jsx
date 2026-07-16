import React, { useId } from "react";

// TicketChain brand mark: a ticket interlocked with a chain link.
// Monochrome — paints in `currentColor`, so it inherits text color
// (e.g. `text-white` inside the gradient logo box). The notches,
// perforation and chain links are cut out, letting the background
// (the gradient box) show through. Matches the full-color favicon /
// PWA app icon in public/favicon.svg.
export default function BrandMark({ className = "", ...props }) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 512 512" fill="none" className={className} {...props}>
      <mask id={maskId}>
        <rect x="112" y="184" width="288" height="144" rx="26" fill="#fff" />
        <circle cx="324" cy="184" r="17" fill="#000" />
        <circle cx="324" cy="328" r="17" fill="#000" />
        <line
          x1="324" y1="206" x2="324" y2="306"
          stroke="#000" strokeWidth="7" strokeLinecap="round" strokeDasharray="1 17"
        />
        <g stroke="#000" strokeWidth="22" fill="none" strokeLinecap="round">
          <rect x="130" y="248" width="104" height="46" rx="23" transform="rotate(-38 182 271)" />
          <rect x="163" y="222" width="104" height="46" rx="23" transform="rotate(-38 215 245)" />
        </g>
      </mask>
      <g transform="rotate(-12 256 256)">
        <rect
          x="112" y="184" width="288" height="144" rx="26"
          fill="currentColor" mask={`url(#${maskId})`}
        />
      </g>
    </svg>
  );
}
