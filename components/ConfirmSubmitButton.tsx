"use client";

import type { ComponentProps, MouseEvent } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export function ConfirmSubmitButton({
  confirmMessage,
  onClick,
  ...props
}: ComponentProps<typeof SubmitButton> & { confirmMessage: string }) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (!window.confirm(confirmMessage)) event.preventDefault();
  }

  return <SubmitButton {...props} onClick={handleClick} />;
}
