"use client";

import { useActionState, useState } from "react";
import { addBranch, type BranchState } from "./actions";

export default function AddBranchForm({ sourceBusiness }: { sourceBusiness: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<BranchState, FormData>(addBranch, {});

  if (!open) {
    return (
      <button className="btn" style={{ marginTop: 12 }} type="button" onClick={() => setOpen(true)}>
        + Add branch
      </button>
    );
  }
  return (
    <form action={action} style={{ marginTop: 14, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 14 }}>
      <input type="hidden" name="source_business" value={sourceBusiness} />
      <div className="row">
        <div className="field">
          <label htmlFor={`bn-${sourceBusiness}`}>Branch name</label>
          <input id={`bn-${sourceBusiness}`} name="branch_name" className="input" required maxLength={60} placeholder="e.g. Makati" />
        </div>
        <div className="field">
          <label>Location</label>
          <input name="location" className="input" />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Contact number</label>
          <input name="phone" className="input" type="tel" />
        </div>
        <div className="field">
          <label>Contact email</label>
          <input name="email" className="input" type="email" />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        The new branch starts empty (its own products, stock and sales). Tax and currency are copied from this business.
      </p>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending} type="submit">{pending ? "Adding..." : "Add branch"}</button>{" "}
      <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
