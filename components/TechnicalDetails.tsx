interface TechnicalDetailItem {
  label: string;
  value: string;
  code?: boolean;
}

export function TechnicalDetails({
  items,
  summary = "查看技術資訊",
  className = "",
}: {
  items: TechnicalDetailItem[];
  summary?: string;
  className?: string;
}) {
  return (
    <details className={`technical-details ${className}`.trim()}>
      <summary>{summary}</summary>
      <dl>
        {items.map((item) => (
          <div key={`${item.label}-${item.value}`}>
            <dt>{item.label}</dt>
            <dd>{item.code === false ? item.value : <code>{item.value}</code>}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
