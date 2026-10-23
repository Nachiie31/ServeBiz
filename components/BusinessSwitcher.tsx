"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { switchBusiness } from "@/app/(app)/businesses/actions";

export type SwitcherGroup = { name: string; branches: { id: string; label: string }[] };

export default function BusinessSwitcher({ groups, currentId }: { groups: SwitcherGroup[]; currentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const total = groups.reduce((n, g) => n + g.branches.length, 0);
  if (total < 2) return null;
  return (
    <select
      className="input"
      aria-label="Switch business or branch"
      value={currentId}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        start(async () => {
          const to = await switchBusiness(id);
          router.push(to);
          router.refresh();
        });
      }}
      style={{ margin: "0 0 12px" }}
    >
      {groups.map((g) => (
        <optgroup key={g.name + g.branches[0].id} label={g.name}>
          {g.branches.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
