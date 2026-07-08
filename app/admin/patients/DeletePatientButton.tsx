"use client";

import { useFormStatus } from "react-dom";
import { deletePatientAction } from "../actions";

function Inner({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(`確定刪除病患「${name}」?此動作無法復原。`)) e.preventDefault();
      }}
      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
    >
      {pending ? "刪除中…" : "刪除"}
    </button>
  );
}

export function DeletePatientButton({ id, name }: { id: string; name: string }) {
  return (
    <form action={deletePatientAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <Inner name={name} />
    </form>
  );
}
