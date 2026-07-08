import type { ReactNode } from "react";

// 抓 http(s):// 或 www. 開頭的網址
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
// 網址結尾常見的標點(不算網址的一部分)
const TRAILING_RE = /[)\]}.,!?;:，。！?、」』]+$/;

/**
 * 把純文字中的網址轉成可點擊連結(其餘保持原字串)。
 * 用於聊天訊息:病患/櫃檯貼的連結可直接點開。
 */
export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const start = m.index;
    if (start > last) out.push(text.slice(last, start));

    let url = m[0];
    let trailing = "";
    const t = url.match(TRAILING_RE);
    if (t) {
      trailing = t[0];
      url = url.slice(0, url.length - trailing.length);
    }
    const href = url.startsWith("http") ? url : `https://${url}`;
    out.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all underline underline-offset-2"
      >
        {url}
      </a>,
    );
    if (trailing) out.push(trailing);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
