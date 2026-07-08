"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";

/**
 * 表單送出按鈕:送出期間自動 disable 並顯示轉圈,讓使用者知道「有反應、處理中」。
 * 需放在 <form action={serverAction}> 內(useFormStatus 讀最近的父表單狀態)。
 */
export function SubmitButton({
  children,
  className,
  disabled,
  ...rest
}: ComponentProps<"button">) {
  const { pending } = useFormStatus();
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
        {children}
      </span>
    </button>
  );
}
