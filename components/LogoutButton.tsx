"use client";

import { clearCachedPages } from "@/components/PwaRegister";
import { queueFor } from "@/lib/offline-queue";

/** Log out button. Warns if sales rung up offline have not been sent yet, and forgets the cached POS page. */
export default function LogoutButton({ label, userId }: { label: string; userId: string }) {
  return (
    <button
      className="btn btn-block"
      type="submit"
      onClick={(e) => {
        try {
          const waiting = queueFor(localStorage, userId).length;
          if (waiting > 0 && !window.confirm(`${waiting} offline sale${waiting === 1 ? " has" : "s have"} not been sent yet. They stay on this device and send when you log in again here. Log out anyway?`)) {
            e.preventDefault();
            return;
          }
        } catch {
          // storage unavailable: nothing to warn about
        }
        clearCachedPages();
      }}
    >
      {label}
    </button>
  );
}
