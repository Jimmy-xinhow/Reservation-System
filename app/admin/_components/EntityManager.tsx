"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export interface ManagedItem {
  id: string;
  name: string;
  secondary: string | null;
  active: boolean;
}
type ServerAction = (fd: FormData) => Promise<void>;

export default function EntityManager({
  title,
  description,
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
  description?: string;
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
  const formRef = useRef<HTMLFormElement>(null);

  function edit(it: ManagedItem) {
    setEditingId(it.id);
    setName(it.name);
    setSecondary(it.secondary ?? "");
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function cancel() {
    setEditingId(null);
    setName("");
    setSecondary("");
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div><h2 className="font-semibold text-slate-900">{title}</h2>{description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}</div>
        <span className="text-xs tabular-nums text-slate-500">{items.length} 位</span>
      </div>

      <form
        ref={formRef}
        action={editingId ? updateAction : createAction}
        className={`grid scroll-mt-24 gap-3 border-b border-slate-200 p-4 sm:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.2fr)_auto] ${editingId ? "bg-brand-50/40" : "bg-white"}`}
      >
        {editingId && <input type="hidden" name="id" value={editingId} />}
        <label className="text-sm">
          <span className="label">{nameLabel}</span>
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </label>
        <label className="text-sm">
          <span className="label">{secondaryLabel}</span>
          <input
            name={secondaryField}
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
            className="input"
          />
        </label>
        <div className="flex flex-wrap items-end gap-2"><SubmitButton className="btn btn-primary">{editingId ? "儲存人員修改" : "新增服務人員"}</SubmitButton>{editingId && <button type="button" onClick={cancel} className="btn btn-secondary">取消編輯</button>}</div>
      </form>

      <div className="admin-table-shell admin-table-mobile-cards border-0">
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
                <td colSpan={4} data-mobile-empty="true" className="py-8 text-center text-slate-400">
                  尚無資料
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className={editingId === it.id ? "bg-brand-50/60" : ""}>
                <td data-label={nameLabel} className="font-medium text-slate-800">{it.name}</td>
                <td data-label={secondaryLabel} className="text-slate-500">{it.secondary || "—"}</td>
                <td data-label="狀態">
                  <span className={`badge ${it.active ? "bg-accent-500/10 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                    {it.active ? "啟用" : "停用"}
                  </span>
                </td>
                <td data-label="操作">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => edit(it)}
                      className="admin-inline-action text-brand-700"
                    >
                      編輯人員
                    </button>
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="active" value={String(it.active)} />
                      <SubmitButton className="admin-inline-action">
                        {it.active ? "停用人員" : "啟用人員"}
                      </SubmitButton>
                    </form>
                    {deleteAction && (
                      <form action={deleteAction}>
                        <input type="hidden" name="id" value={it.id} />
                        <SubmitButton className="admin-inline-action text-red-700">刪除</SubmitButton>
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
