import Link from "next/link";
import type { ReactNode } from "react";

export function AdminModal({
  title,
  description,
  closeHref,
  children,
  size = "standard",
}: {
  title: string;
  description?: string;
  closeHref: string;
  children: ReactNode;
  size?: "standard" | "wide";
}) {
  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section
        className={`admin-modal admin-modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
      >
        <header className="admin-modal-header">
          <div>
            <h2 id="admin-modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <Link href={closeHref} className="icon-button" aria-label="關閉視窗">×</Link>
        </header>
        <div className="admin-modal-body">{children}</div>
      </section>
    </div>
  );
}
