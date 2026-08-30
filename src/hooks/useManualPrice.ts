"use client";

import { useState } from "react";
import { ESPriceData } from "./useESPrice";

export type PriceSource = "live" | "manual" | "none";

export interface ManualPriceState {
  manualPriceStr: string;
  manualOverride: boolean;
  currentPrice: number;
  priceSource: PriceSource;
  onChange: (value: string) => void;
  onFocus: () => void;
  clear: () => void;
}

export function useManualPrice(esPrice: ESPriceData): ManualPriceState {
  const [manualPriceStr, setManualPriceStr] = useState<string>("");
  const [manualOverride, setManualOverride] = useState(false);

  // Manual override beats live feed; both beat zero.
  const manualPrice = parseFloat(manualPriceStr) || 0;
  const currentPrice =
    manualOverride && manualPrice > 0 ? manualPrice : esPrice.price;
  const priceSource: PriceSource =
    manualOverride && manualPrice > 0
      ? "manual"
      : esPrice.price > 0
        ? "live"
        : "none";

  function onChange(value: string) {
    setManualPriceStr(value);
    setManualOverride(true);
  }

  function onFocus() {
    if (!manualOverride && currentPrice > 0) {
      setManualPriceStr(currentPrice.toString());
      setManualOverride(true);
    }
  }

  function clear() {
    setManualOverride(false);
    setManualPriceStr("");
  }

  return {
    manualPriceStr,
    manualOverride,
    currentPrice,
    priceSource,
    onChange,
    onFocus,
    clear,
  };
}
