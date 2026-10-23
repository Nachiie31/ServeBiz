"use client";

import type { ClipboardEvent, InputHTMLAttributes, KeyboardEvent, WheelEvent } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** whole numbers only (also blocks the decimal point) */
  integer?: boolean;
};

/**
 * A number box that only accepts digits (and one decimal point unless `integer`).
 * Browsers let you type "e", "+" and "-" into type="number" (scientific notation and signs);
 * this blocks them while typing and pasting. Negative numbers are never valid in this app.
 */
export default function NumberInput({ integer, onKeyDown, onPaste, onWheel, inputMode, ...rest }: Props) {
  const blocked = integer ? ["e", "E", "+", "-", ".", ","] : ["e", "E", "+", "-"];

  function keyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (blocked.includes(e.key)) e.preventDefault();
    onKeyDown?.(e);
  }
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const pattern = integer ? /^\d+$/ : /^\d*\.?\d*$/;
    if (!pattern.test(text.trim())) e.preventDefault();
    onPaste?.(e);
  }
  function wheel(e: WheelEvent<HTMLInputElement>) {
    // Scrolling the page over a focused number box must not change its value.
    (e.currentTarget as HTMLInputElement).blur();
    onWheel?.(e);
  }

  return (
    <input
      {...rest}
      type="number"
      min={rest.min ?? 0}
      inputMode={inputMode ?? (integer ? "numeric" : "decimal")}
      step={rest.step ?? (integer ? 1 : "0.01")}
      onKeyDown={keyDown}
      onPaste={paste}
      onWheel={wheel}
    />
  );
}
