export interface Level {
  price: number;
  type: "support" | "resistance";
  major: boolean;
}

export interface Plan {
  id: string;
  email_date: string;
  subject: string;
  body: string;
  created_at: string;
}

export interface Trade {
  id: string;
  symbol: string;
  direction: "long" | "short";
  contracts: number;
  entry_price: number;
  exit_75_price: number | null;
  exit_runner_price: number | null;
  setup_type: "Failed Breakdown" | "Flag" | "Trendline" | "Other" | null;
  point_value: number;
  notes: string | null;
  pnl: number | null;
  created_at: string;
}

export interface ParsedPlan {
  supports: Level[];
  resistances: Level[];
  lean: string;
  bullTargets: number[];
  bearTargets: number[];
  triggers: string[];
}
