"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="card space-y-4 p-8">
        <h2 className="text-lg font-bold text-slate-900">操作發生問題</h2>
        <p className="text-sm leading-6 text-slate-500">
          剛才的動作沒有完成。請先重試；若持續發生，請把下方錯誤識別碼提供給系統管理人員。
        </p>
        {error.digest && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 break-words">
            錯誤識別碼：<code>{error.digest}</code>
          </p>
        )}
        <button onClick={reset} className="btn btn-primary">
          重試
        </button>
      </div>
    </div>
  );
}
