import Image from "next/image";
import Link from "next/link";
import { SHOWCASE_TEMPLATES } from "@/lib/showcase-templates";
import styles from "@/components/showcase/showcase.module.css";

export default function ShowcaseIndexPage() {
  return (
    <main className={styles.indexPage}>
      <header className={styles.indexHeader}>
        <p className={styles.indexKicker}>XINHOW · VISUAL REVIEW 01</p>
        <h1>八種產業，八套獨立的<br />品牌版型語言。</h1>
        <div className={styles.indexIntro}>
          <p>此區只用於設計審稿。每套包含桌面與手機重排、首屏與一個關鍵內容段落，尚未串接正式預約資料。</p>
          <p>實拍照片為設計佔位素材；客戶上線時改由品牌方上傳。</p>
        </div>
      </header>

      <section className={styles.indexList} aria-label="產業版型清單">
        {SHOWCASE_TEMPLATES.map((template) => (
          <Link key={template.slug} href={`/showcase/${template.slug}`} className={styles.indexItem}>
            <span className={styles.indexNumber}>{template.number}</span>
            <div className={styles.indexImage}>
              <Image src={template.image} alt="" fill sizes="(max-width: 768px) 32vw, 18vw" className={styles.coverImage} />
            </div>
            <div className={styles.indexName}>
              <span>{template.industry}</span>
              <strong>{template.name}</strong>
            </div>
            <div className={styles.indexMeta}>
              <span>{template.direction}</span>
              <span>參考 {template.reference}</span>
            </div>
            <div className={styles.indexPalette} aria-label="建議色盤">
              {template.palette.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
            </div>
            <span className={styles.indexArrow}>↗</span>
          </Link>
        ))}
      </section>

      <footer className={styles.indexFooter}>
        <span>DESIGN DIRECTION — NOT PRODUCTION CONTENT</span>
        <span>2026 / 08</span>
      </footer>
    </main>
  );
}
