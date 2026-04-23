import { Level, ParsedPlan } from "./types";

/**
 * Parse Mancini's email text into structured levels and scenarios.
 * Handles formats like:
 *   "Supports are: 6685 (major), 6676, 6663 (major), ..."
 *   "Resistances are: 6700 (major), 6716 (major), ..."
 *   Ranges like "6778-82" (= 6778 to 6782) or "6820-6822"
 */
export function parseLevels(text: string): ParsedPlan {
  const supports = extractLevels(text, "support");
  const resistances = extractLevels(text, "resistance");
  const lean = extractLean(text);
  const bullTargets = extractScenarioTargets(text, "bull");
  const bearTargets = extractScenarioTargets(text, "bear");
  const triggers = extractTriggers(text);

  return { supports, resistances, lean, bullTargets, bearTargets, triggers };
}

function extractLevels(text: string, type: "support" | "resistance"): Level[] {
  const label = type === "support" ? "supports? are" : "resistances? are";
  const regex = new RegExp(`${label}[:\\s]+([^]*?)(?:\\.|$)`, "i");
  const match = text.match(regex);
  if (!match) return [];

  const chunk = match[1];
  const levels: Level[] = [];

  // Match: number, optional range like -82 or -6822, optional (major)
  const levelRegex = /(\d{4,5})(?:\s*-\s*(\d{2,5}))?\s*(\(major\))?/gi;
  let m;

  while ((m = levelRegex.exec(chunk)) !== null) {
    const base = parseInt(m[1]);
    const major = !!m[3];

    if (m[2]) {
      // Range: "6778-82" means 6778 to 6782, "6820-6822" means 6820 to 6822
      let rangeEnd: number;
      if (m[2].length <= 2) {
        // Short range: take the prefix from base
        const prefix = m[1].slice(0, m[1].length - m[2].length);
        rangeEnd = parseInt(prefix + m[2]);
      } else {
        rangeEnd = parseInt(m[2]);
      }
      // Add both ends of the range
      levels.push({ price: base, type, major });
      if (rangeEnd !== base) {
        levels.push({ price: rangeEnd, type, major });
      }
    } else {
      levels.push({ price: base, type, major });
    }
  }

  return levels;
}

function extractLean(text: string): string {
  const leanMatch = text.match(
    /(?:general\s+)?lean\s+(?:is\s+)?(.+?)(?:\.|$)/im
  );
  if (leanMatch) return leanMatch[1].trim();

  // Fallback: look for "lean" keyword nearby
  const lines = text.split("\n");
  for (const line of lines) {
    if (/lean/i.test(line)) {
      return line.replace(/^[•·\-\s]+/, "").trim();
    }
  }
  return "";
}

function extractScenarioTargets(
  text: string,
  scenario: "bull" | "bear"
): number[] {
  const label = scenario === "bull" ? "bull" : "bear";
  const regex = new RegExp(`${label}[^:]*:[^]*?(?=bear|bull|supports?|$)`, "i");
  const match = text.match(regex);
  if (!match) return [];

  const numbers: number[] = [];
  const numRegex = /\b(\d{4,5})\b/g;
  let m;
  while ((m = numRegex.exec(match[0])) !== null) {
    const n = parseInt(m[1]);
    if (n > 3000 && n < 20000) {
      // Reasonable ES price range
      if (!numbers.includes(n)) numbers.push(n);
    }
  }
  return numbers;
}

function extractTriggers(text: string): string[] {
  const triggers: string[] = [];
  const lines = text.split(/\n|\.(?=\s)/);

  for (const line of lines) {
    const trimmed = line.trim();
    // Look for if/then patterns
    if (
      /\bif\b.*\b(hold|fail|recover|tag|break|recapture|lost)\b/i.test(trimmed)
    ) {
      triggers.push(trimmed.replace(/^[•·\-\s]+/, ""));
    }
    // Look for "watch for" patterns
    if (/\bwatch\s+for\b/i.test(trimmed)) {
      triggers.push(trimmed.replace(/^[•·\-\s]+/, ""));
    }
  }

  return triggers;
}

/**
 * Calculate P&L for a trade using the 75/25 split
 */
export function calculatePnL(
  direction: "long" | "short",
  entryPrice: number,
  exit75Price: number | null,
  exitRunnerPrice: number | null,
  contracts: number,
  pointValue: number
): number {
  let totalPnL = 0;
  const sign = direction === "long" ? 1 : -1;

  if (exit75Price !== null) {
    const contracts75 = contracts * 0.75;
    totalPnL += (exit75Price - entryPrice) * sign * contracts75 * pointValue;
  }

  if (exitRunnerPrice !== null) {
    const contracts25 = contracts * 0.25;
    totalPnL +=
      (exitRunnerPrice - entryPrice) * sign * contracts25 * pointValue;
  }

  return Math.round(totalPnL * 100) / 100;
}
