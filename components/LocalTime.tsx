"use client";

import { useEffect, useState } from "react";

/** Formats a timestamp in the viewer's own timezone (the server runs in UTC). */
export default function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [iso]);
  return <time dateTime={iso}>{text || " "}</time>;
}
