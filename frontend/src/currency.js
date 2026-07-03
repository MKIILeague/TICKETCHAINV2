// ─── Display currency (demo) ────────────────────────────────────────────────
// The platform settles entirely in ETH on Sepolia. Every on-chain amount — the
// price passed to `mintTicket`/`listTicketForResale`, tx `value`, balances — is
// REAL ETH and is never converted or rounded here. Malaysian Ringgit (RM) is a
// *presentation-only* layer so the demo reads naturally to a local audience:
// we show RM as the headline price with the true ETH amount kept alongside in a
// smaller font. Editing RM_PER_ETH changes what the eye sees, nothing on-chain.

export const RM_PER_ETH = 16450; // ≈ 1 ETH in RM for the demo (display only)

/** Headline, display-only fiat price, e.g. "RM 822.50". */
export const rm = (eth) =>
  `RM ${(parseFloat(eth || 0) * RM_PER_ETH).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** The real settled amount, e.g. "0.0500 ETH". Kept small next to the RM price. */
export const ethLabel = (eth, decimals = 4) =>
  `${parseFloat(eth || 0).toFixed(decimals)} ETH`;
