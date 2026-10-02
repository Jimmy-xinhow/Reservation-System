"use client";

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="mx-auto max-w-lg py-16 text-center">
    <div className="card space-y-4 p-8">
      <h2 className="text-lg font-bold text-slate-900">CRM 資料暫時無法確認</h2>
      <p className="text-sm leading-6 text-slate-500">目前無法取得完整資料，這不代表顧客或投遞數為零。請重新載入；若剛才有送出操作，請先查看結果，避免重複建立或修改。</p>
      {error.digest && <p className="break-words text-sm text-slate-600">錯誤識別碼：<code>{error.digest}</code></p>}
      <button onClick={reset} className="btn btn-primary">重新載入</button>
    </div>
  </div>;
}
