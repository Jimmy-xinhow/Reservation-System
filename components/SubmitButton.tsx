"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState, type ComponentProps } from "react";

/**
 * 表單送出按鈕:
 *  - 送出期間自動 disable 並顯示轉圈(讓使用者知道「有反應、處理中」)。
 *  - 成功後短暫顯示「✓ 完成」(pending 由 true→false 且未導向錯誤頁 = 成功)。
 * 需放在 <form action={serverAction}> 內(useFormStatus 讀最近的父表單狀態)。
 * 失敗時 server action 會丟出錯誤 → 導到 error 邊界,本按鈕會卸載,不會誤報成功。
 */
export function SubmitButton({
  children,
  className,
  disabled,
  successText = "完成 ✓",
  ...rest
}: ComponentProps<"button"> & { successText?: string }) {
  const { pending } = useFormStatus();
  const [done, setDone] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setDone(false);
    } else if (wasPending.current) {
      // 剛從「處理中」結束且仍留在此頁 → 視為成功
      wasPending.current = false;
      setDone(true);
      const t = setTimeout(() => setDone(false), 2000);
      return () => clearTimeout(t);
    }
  }, [pending]);

  return (
    <button
      {...rest}
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={className}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {pending && (
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {done ? successText : children}
      </span>
    </button>
  );
}
