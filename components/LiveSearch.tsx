"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

type Suggestion = { label: string; hint?: string };

/**
 * Search box that filters the list as you type (no Search button) and offers suggestions.
 * It writes the text to the page's ?q= parameter and drops the page number.
 */
export default function LiveSearch({
  placeholder,
  ariaLabel,
  suggestUrl,
}: {
  placeholder: string;
  ariaLabel: string;
  /** endpoint returning { items: [{label, hint}] } for ?q= */
  suggestUrl?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const listId = useId();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [, start] = useTransition();
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  function apply(next: string) {
    const sp = new URLSearchParams(params.toString());
    if (next.trim()) sp.set("q", next.trim());
    else sp.delete("q");
    sp.delete("page");
    const qs = sp.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function onChange(next: string) {
    setValue(next);
    setActive(-1);
    if (filterTimer.current) clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => apply(next), 250);

    if (!suggestUrl) return;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!next.trim()) {
      setItems([]);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${suggestUrl}?q=${encodeURIComponent(next.trim())}`);
        if (!res.ok) return;
        const body = (await res.json()) as { items: Suggestion[] };
        setItems(body.items ?? []);
        setOpen(true);
      } catch {
        setItems([]);
      }
    }, 150);
  }

  function pick(s: Suggestion) {
    setValue(s.label);
    setOpen(false);
    setItems([]);
    if (filterTimer.current) clearTimeout(filterTimer.current);
    apply(s.label);
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      if (filterTimer.current) clearTimeout(filterTimer.current);
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, []);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && items[active]) pick(items[active]);
      else {
        if (filterTimer.current) clearTimeout(filterTimer.current);
        setOpen(false);
        apply(value);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && items.length > 0;
  return (
    <div className="live-search" ref={box}>
      <input
        className="input"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => items.length && setOpen(true)}
      />
      {showList && (
        <ul className="suggest" id={listId} role="listbox">
          {items.map((s, i) => (
            <li
              key={`${s.label}-${s.hint ?? i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <span>{s.label}</span>
              {s.hint && <span className="muted">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
