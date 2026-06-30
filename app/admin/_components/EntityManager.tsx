"use client";

import { useState } from "react";

export interface ManagedItem {
  id: string;
  name: string;
  secondary: string | null;
  active: boolean;
}
type ServerAction = (fd: FormData) => Promise<void>;

export default function EntityManager({
  title,
  nameLabel,
  secondaryLabel,
  secondaryField,
  items,
  createAction,
  updateAction,
  toggleAction,
  deleteAction,
}: {
  title: string;
  nameLabel: string;
  secondaryLabel: string;
  secondaryField: string;
  items: ManagedItem[];
  createAction: ServerAction;
  updateAction: ServerAction;
  toggleAction: ServerAction;
  deleteAction?: ServerAction;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [secondary, setSecondary] = useState("");

  function edit(it: ManagedItem) {
    setEditingId(it.id);
    setName(it.name);
    setSecondary(it.secondary ?? "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancel() {
    setEditingId(null);
    setName("");
    setSecondary("");
  }

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-900">{title}</h2>

      <form
        action={editingId ? updateAction : createAction}
        className={`card flex flex-wrap items-end gap-3 p-4 ${editingId ? "ring-2 ring-brand-200" : ""}`}
      >
        {editingId && <input type="hidden" name="id" value={editingId} />}
        <label className="block text-sm font-medium text-slate-600">
          {nameLabel}
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input mt-1"
          />
        </label>
        <label className="block grow text-sm font-medium text-slate-600">
          {secondaryLabel}
          <input
            name={secondaryField}
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
            className="input mt-1"
          />
        </label>
        <button className="btn btn-primary">{editingId ? "儲存修改" : "新增"}</button>
        {editingId && (
          <button type="button" onClick={cancel} className="btn btn-secondary">
            取消
          </button>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{nameLabel}</th>
              <th>{secondaryLabel}</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-400">
                  尚無資料
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className={editingId === it.id ? "bg-brand-50/60" : ""}>
                <td className="font-medium text-slate-800">{it.name}</td>
                <td className="text-slate-500">{it.secondary || "—"}</td>
                <td>
                  <span className={`badge ${it.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                    {it.active ? "啟用" : "停用"}
                  </span>
                </td>
                <td>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => edit(it)}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      編輯
                    </button>
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="active" value={String(it.active)} />
                      <button className="text-xs font-medium text-slate-600 hover:underline">
                        {it.active ? "停用" : "啟用"}
                      </button>
                    </form>
                    {deleteAction && (
                      <form action={deleteAction}>
                        <input type="hidden" name="id" value={it.id} />
                        <button className="text-xs font-medium text-red-600 hover:underline">刪除</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
