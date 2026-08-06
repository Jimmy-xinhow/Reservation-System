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
        if (!confirm(`確定移除顧客「${name}」？將從顧客列表移除，既有服務紀錄仍會保留。`))
          e.preventDefault();
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
