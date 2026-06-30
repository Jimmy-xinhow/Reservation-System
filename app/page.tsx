export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">診所預約系統</h1>
      <p className="text-gray-600">
        病患請由 LINE 官方帳號進入預約。櫃檯請至{" "}
        <a className="text-blue-600 underline" href="/admin">
          後台
        </a>
        。
      </p>
    </main>
  );
}
