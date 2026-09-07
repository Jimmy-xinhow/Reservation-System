export default function AdminLoading() {
  return (
    <div className="admin-page" role="status" aria-label="後台頁面載入中">
      <div className="admin-loading-header">
        <span />
        <strong />
        <i />
      </div>
      <div className="admin-loading-strip">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
      <div className="admin-loading-grid"><span /><span /></div>
      <span className="sr-only">載入中</span>
    </div>
  );
}
