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
        <p className="text-sm text-slate-500">
          剛才的動作沒有完成。請再試一次;若持續發生,請確認網路或稍後再操作。
        </p>
        {error?.message && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-left text-xs text-slate-500 break-words">
            {error.message}
            {error.digest ? `(代碼 ${error.digest})` : ""}
          </p>
        )}
        <button onClick={reset} className="btn btn-primary">
          重試
        </button>
      </div>
    </div>
  );
}
