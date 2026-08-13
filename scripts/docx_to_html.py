from __future__ import annotations

import argparse
import base64
import html
from pathlib import Path

from docx import Document
from docx.document import Document as DocumentType
from docx.oxml.ns import qn
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph


def iter_blocks(document: DocumentType):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def image_tags(paragraph: Paragraph) -> list[str]:
    tags: list[str] = []
    descriptions = [node.get("descr") or "操作手冊畫面" for node in paragraph._p.iter(qn("wp:docPr"))]
    for index, blip in enumerate(paragraph._p.iter(qn("a:blip"))):
        relation_id = blip.get(qn("r:embed"))
        if not relation_id:
            continue
        part = paragraph.part.related_parts.get(relation_id)
        if part is None or not hasattr(part, "blob"):
            continue
        mime = getattr(part, "content_type", "image/png")
        encoded = base64.b64encode(part.blob).decode("ascii")
        alt = html.escape(descriptions[index] if index < len(descriptions) else "操作手冊畫面", quote=True)
        # The HTML is also printed to PDF in one pass. Native lazy loading can
        # leave off-screen figures undecoded when Chromium starts printing, so
        # every embedded screenshot must load eagerly.
        tags.append(f'<img src="data:{mime};base64,{encoded}" alt="{alt}">')
    return tags


def paragraph_html(paragraph: Paragraph) -> str:
    style = paragraph.style.name if paragraph.style else "Normal"
    text_parts: list[str] = []
    for run in paragraph.runs:
        value = html.escape(run.text).replace("\n", "<br>")
        if not value:
            continue
        if run.bold:
            value = f"<strong>{value}</strong>"
        text_parts.append(value)
    images = image_tags(paragraph)
    text = "".join(text_parts)

    has_page_break = any(node.get(qn("w:type")) == "page" for node in paragraph._p.iter(qn("w:br")))
    break_html = '<div class="page-break"></div>' if has_page_break else ""
    if images:
        figure = f'<figure>{"".join(images)}</figure>'
        return f"{break_html}{figure}{f'<p>{text}</p>' if text else ''}"
    if not text:
        return break_html
    if style == "Title":
        return f"{break_html}<h1 class=\"document-title\">{text}</h1>"
    if style.startswith("Heading "):
        level = min(3, max(1, int(style.split()[-1])))
        return f"{break_html}<h{level}>{text}</h{level}>"
    if style == "Caption":
        return f"{break_html}<p class=\"caption\">{text}</p>"
    if style.startswith("List Bullet"):
        return f"{break_html}<p class=\"bullet\">{text}</p>"
    if style.startswith("List Number"):
        return f"{break_html}<p class=\"numbered\">{text}</p>"
    return f"{break_html}<p>{text}</p>"


def cell_html(cell, header: bool) -> str:
    tag = "th" if header else "td"
    content = "".join(paragraph_html(paragraph) for paragraph in cell.paragraphs)
    return f"<{tag}>{content}</{tag}>"


def table_html(table: Table) -> str:
    rows: list[str] = []
    for index, row in enumerate(table.rows):
        rows.append("<tr>" + "".join(cell_html(cell, index == 0) for cell in row.cells) + "</tr>")
    return '<div class="table-wrap"><table>' + "".join(rows) + "</table></div>"


def convert(source: Path, output: Path) -> None:
    document = Document(source)
    body: list[str] = []
    for block in iter_blocks(document):
        body.append(paragraph_html(block) if isinstance(block, Paragraph) else table_html(block))

    title = html.escape(document.core_properties.title or "XINHOW 圖文操作手冊")
    css = """
      :root { --navy:#08263a; --blue:#2178c7; --slate:#475569; --line:#dbe5ef; --pale:#f4f8fc; }
      * { box-sizing:border-box; }
      html { background:#e7eef5; }
      body { width:min(210mm,100%); margin:0 auto; padding:16mm 17mm 18mm; background:white; color:var(--slate); font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif; font-size:10.2pt; line-height:1.55; }
      h1,h2,h3 { color:var(--navy); break-after:avoid; margin:1.1em 0 .45em; line-height:1.25; }
      h1 { font-size:22pt; border-bottom:3px solid var(--blue); padding-bottom:.25em; }
      h2 { color:var(--blue); font-size:15pt; }
      h3 { font-size:12pt; }
      .document-title { margin-top:0; font-size:28pt; border:0; }
      p { margin:.35em 0 .65em; }
      .caption { color:#64748b; font-size:8.7pt; text-align:center; margin-top:.2em; break-before:avoid; }
      .bullet { padding-left:1.4em; position:relative; }
      .bullet::before { content:"•"; color:var(--blue); position:absolute; left:.35em; font-weight:700; }
      body { counter-reset:item; }
      .numbered { counter-increment:item; padding-left:2em; position:relative; }
      .numbered::before { content:counter(item) "."; color:var(--blue); position:absolute; left:.2em; font-weight:700; }
      figure { margin:.75em 0 .25em; text-align:center; break-inside:avoid; }
      figure img { display:block; max-width:100%; max-height:205mm; margin:0 auto; border:1px solid var(--line); border-radius:8px; object-fit:contain; }
      .table-wrap { margin:.6em 0 1em; overflow:hidden; break-inside:auto; }
      table { width:100%; border-collapse:collapse; font-size:8.8pt; }
      tr { break-inside:avoid; }
      th { background:var(--navy); color:white; font-weight:700; text-align:left; }
      th,td { border:1px solid var(--line); padding:7px 8px; vertical-align:top; }
      td p, th p { margin:0 0 .25em; }
      tr:nth-child(odd) td { background:var(--pale); }
      .page-break { break-before:page; }
      @page { size:A4; margin:13mm 12mm 15mm; @bottom-right { content:"第 " counter(page) " 頁"; color:#64748b; font-size:8pt; } }
      @media screen { body { box-shadow:0 12px 40px rgba(8,38,58,.16); } }
      @media print { html,body { background:white; width:auto; margin:0; padding:0; box-shadow:none; } }
    """
    rendered = f"<!doctype html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><style>{css}</style></head><body>{''.join(body)}</body></html>"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    convert(args.source.resolve(), args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
