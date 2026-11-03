// ─── Display currency (demo) ────────────────────────────────────────────────
// Prices are simulated ledger values. Purchase transactions send zero ETH;
// Sepolia test ETH only pays network gas. RM_PER_ETH is a fixed display rate.

export const RM_PER_ETH = 16450; // ≈ 1 ETH in RM for the demo (display only)

/** Headline, display-only fiat price, e.g. "RM 822.50". */
export const rm = (eth) =>
  `RM ${(parseFloat(eth || 0) * RM_PER_ETH).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** The simulated ledger amount, e.g. "0.0500 ETH". Kept small next to the RM price. */
export const ethLabel = (eth, decimals = 4) =>
  `${parseFloat(eth || 0).toFixed(decimals)} ETH`;
