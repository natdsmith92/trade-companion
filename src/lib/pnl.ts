import { Trade } from "./types";

export interface PnLBreakdown {
  realized: number;
  unrealized: number;
  total: number;
  hasOpenTrades: boolean;
}

// Live P&L for a session: realized P&L from closed exits plus
// unrealized P&L on the runner (or fully open trades) marked at currentPrice.
export function computePnL(trades: Trade[], currentPrice: number): PnLBreakdown {
  let realized = 0;
  let unrealized = 0;

  for (const t of trades) {
    realized += t.pnl ?? 0;

    if (currentPrice <= 0) continue;

    const sign = t.direction === "long" ? 1 : -1;

    // 75% has exited but the 25% runner is still open: mark the remaining quarter.
    if (t.exit_75_price && !t.exit_runner_price) {
      unrealized +=
        (currentPrice - t.entry_price) * sign * t.contracts * 0.25 * t.point_value;
      continue;
    }

    // Fully open trade with no exits at all: mark all contracts.
    if (!t.exit_75_price && !t.exit_runner_price) {
      unrealized +=
        (currentPrice - t.entry_price) * sign * t.contracts * t.point_value;
    }
  }

  return {
    realized,
    unrealized,
    total: realized + unrealized,
    hasOpenTrades: unrealized !== 0,
  };
}
