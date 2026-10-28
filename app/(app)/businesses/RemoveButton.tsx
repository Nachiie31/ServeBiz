"use client";

import { useActionState, useState } from "react";
import { removeBranch, removeBusiness, type RemoveState } from "./actions";

type Props = {
  kind: "branch" | "business";
  id: string;
  /** exact name the person must type */
  name: string;
  /** when set the button is disabled and this explains why */
  blockedReason?: string;
};

export default function RemoveButton({ kind, id, name, blockedReason }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RemoveState, FormData>(kind === "branch" ? removeBranch : removeBusiness, {});
  const label = kind === "branch" ? "Remove branch" : "Remove business";

  if (blockedReason) {
    return (
      <span className="muted" style={{ fontSize: 13 }} title={blockedReason}>
        <button className="btn btn-sm" type="button" disabled aria-describedby={`why-${id}`}>{label}</button>
        <span id={`why-${id}`} style={{ marginLeft: 8 }}>{blockedReason}</span>
      </span>
    );
  }
  if (!open) {
    return (
      <button className="btn btn-sm" type="button" onClick={() => setOpen(true)}>{label}</button>
    );
  }
  return (
    <form action={action} className="remove-box">
      <input type="hidden" name="id" value={id} />
      <p style={{ margin: "0 0 8px" }}>
        <strong>This permanently deletes {kind === "branch" ? "this branch" : "this business and all its branches"}</strong>: products, stock,
        sales, team and settings. Staff lose access. It cannot be undone.
        {" "}Any Stripe account connected to it is not closed; manage that in Stripe.
      </p>
      <label htmlFor={`rm-${id}`} style={{ display: "block", marginBottom: 4 }}>Type <strong>{name}</strong> to confirm</label>
      <input id={`rm-${id}`} name="confirm" className="input" autoComplete="off" required style={{ maxWidth: 320 }} />
      {state.error && <div className="alert err" role="alert" style={{ marginTop: 8 }}>{state.error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn btn-danger" type="submit" disabled={pending}>{pending ? "Removing..." : label}</button>
        <button className="btn" type="button" onClick={() => setOpen(false)} disabled={pending}>Keep it</button>
      </div>
    </form>
  );
}
