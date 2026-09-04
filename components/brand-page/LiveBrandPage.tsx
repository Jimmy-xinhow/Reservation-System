import Image from "next/image";
import type { PublicBrandPageData } from "@/lib/brand-page";
import styles from "./LiveBrandPage.module.css";

function BrandImage({ src, alt, priority = false, sizes }: { src: string; alt: string; priority?: boolean; sizes: string }) {
  if (src.startsWith("/")) return <Image src={src} alt={alt} fill priority={priority} sizes={sizes} />;
  return (
    // Brand-managed HTTPS images cannot use next/image without a fixed remote host allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} className={styles.runtimeImage} />
  );
}

function eventHref(brand: PublicBrandPageData, eventSlug: string): string {
  if (!brand.links.registration) return brand.links.primary;
  const query = brand.links.registration.split("?")[1];
  return `/register/event/${encodeURIComponent(eventSlug)}${query ? `?${query}` : ""}`;
}

function eventMeta(event: PublicBrandPageData["events"][number]): string {
  if (!event.nextSessionAt) return event.description ?? "查看課程內容、場次與名額";
  const when = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.nextSessionAt));
  return `${event.nextSessionName ?? "近期場次"} · ${when}${event.nextSessionCapacity ? ` · ${event.nextSessionCapacity} 人` : ""}`;
}

function BrandMark({ brand }: { brand: PublicBrandPageData }) {
  if (!brand.logoUrl) return <span>{brand.name}</span>;
  return (
    // Brand-managed HTTPS logos cannot use next/image without a fixed remote host allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logoUrl} alt={brand.name} />
  );
}

function PublicHeader({ brand }: { brand: PublicBrandPageData }) {
  return (
    <header className={styles.header}>
      <a className={styles.brandMark} href="#top" aria-label={`${brand.name} 首頁`}><BrandMark brand={brand} /></a>
      <nav aria-label="品牌頁導覽">
        <a href="#offers">服務內容</a>
        <a href="#about">關於我們</a>
        <a href={brand.links.records}>我的紀錄</a>
      </nav>
      <a className={styles.headerCta} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
    </header>
  );
}

function OfferRows({ brand, mode }: { brand: PublicBrandPageData; mode: "beauty" | "education" | "fitness" }) {
  const eventRows = brand.events.map((event) => ({
    id: event.id,
    title: event.title,
    description: eventMeta(event),
    href: eventHref(brand, event.slug),
    action: mode === "education" ? "查看課綱與場次" : "查看場次",
  }));
  const serviceRows = brand.services.map((service) => ({
    id: service.id,
    title: service.name,
    description: service.description ?? (mode === "beauty" ? "查看療程內容、服務人員與可約時間" : "查看服務內容與可預約時段"),
    href: brand.links.booking ?? brand.links.primary,
    action: mode === "education" ? "查看課程" : "查看時段",
  }));
  const rows = mode === "education" ? [...eventRows, ...serviceRows] : [...serviceRows, ...eventRows];
  return (
    <div className={styles.offerRows}>
      {rows.slice(0, 6).map((item, index) => (
        <a href={item.href} key={`${item.id}-${index}`}>
          <span className={styles.offerNumber}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.offerCopy}><strong>{item.title}</strong><small>{item.description}</small></span>
          <span className={styles.offerAction}>{item.action}<b aria-hidden="true">↗</b></span>
        </a>
      ))}
      {rows.length === 0 && (
        <a href={brand.links.primary}>
          <span className={styles.offerNumber}>01</span>
          <span className={styles.offerCopy}><strong>{brand.content.section_title}</strong><small>{brand.content.section_description}</small></span>
          <span className={styles.offerAction}>{brand.content.primary_cta_label}<b aria-hidden="true">↗</b></span>
        </a>
      )}
    </div>
  );
}

function TrustStrip({ brand, labels }: { brand: PublicBrandPageData; labels: string[] }) {
  const points = [brand.content.trust_point_1, brand.content.trust_point_2, brand.content.trust_point_3];
  return <div className={styles.trustStrip}>{points.map((point, index) => <div key={point}><span>{labels[index]}</span><strong>{point}</strong></div>)}</div>;
}

function SharedAbout({ brand, eyebrow }: { brand: PublicBrandPageData; eyebrow: string }) {
  return (
    <section className={styles.about} id="about">
      <figure><BrandImage src={brand.content.gallery_image_url} alt={`${brand.name} 品牌服務情境`} sizes="(max-width: 760px) 100vw, 46vw" /></figure>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{brand.content.about_title}</h2>
        <p>{brand.content.about_description}</p>
        <dl>
          <div><dt>服務入口</dt><dd>線上預約與報名</dd></div>
          <div><dt>紀錄查詢</dt><dd>隨時查看進度</dd></div>
          <div><dt>服務地點</dt><dd>{brand.address ?? "請於預約時確認"}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function PublicFooter({ brand }: { brand: PublicBrandPageData }) {
  return (
    <>
      <section className={styles.finalCta}>
        <div><p className={styles.eyebrow}>READY WHEN YOU ARE</p><h2>{brand.content.secondary_cta_label}</h2></div>
        <div className={styles.ctaGroup}>
          <a className={styles.primaryButton} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
          <a className={styles.secondaryButton} href={brand.links.records}>查看我的紀錄</a>
        </div>
      </section>
      <footer className={styles.footer}>
        <div><strong>{brand.name}</strong><span>{brand.address ?? "線上服務"}</span></div>
        <nav>{brand.phone && <a href={`tel:${brand.phone}`}>{brand.phone}</a>}{brand.links.line && <a href={brand.links.line}>官方 LINE</a>}<a href="#top">回到頁首 ↑</a></nav>
      </footer>
      <a className={styles.mobileCta} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
    </>
  );
}

function BeautyBrandPage({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={`${styles.page} ${styles.beauty}`} id="top">
      <PublicHeader brand={brand} />
      <main>
        <section className={styles.splitHero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{brand.content.hero_eyebrow}</p>
            <h1><span>{brand.content.hero_title}</span><em>{brand.content.hero_highlight}</em></h1>
            <p className={styles.heroDescription}>{brand.content.hero_description}</p>
            <div className={styles.ctaGroup}>
              <a className={styles.primaryButton} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
              <a className={styles.secondaryButton} href="#offers">查看服務內容</a>
            </div>
          </div>
          <figure className={styles.heroImage}><BrandImage src={brand.content.hero_image_url} alt={`${brand.name} 服務主視覺`} priority sizes="(max-width: 760px) 100vw, 56vw" /><figcaption>PRIVATE CARE · {brand.address ?? "TAIPEI"}</figcaption></figure>
        </section>
        <TrustStrip brand={brand} labels={["01", "02", "03"]} />
        <section className={styles.offers} id="offers">
          <header><p className={styles.eyebrow}>SERVICES</p><h2>{brand.content.section_title}</h2><p>{brand.content.section_description}</p></header>
          <OfferRows brand={brand} mode="beauty" />
        </section>
        <SharedAbout brand={brand} eyebrow="OUR APPROACH" />
      </main>
      <PublicFooter brand={brand} />
    </div>
  );
}

function EducationBrandPage({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={`${styles.page} ${styles.education}`} id="top">
      <PublicHeader brand={brand} />
      <main>
        <section className={styles.courseHero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{brand.content.hero_eyebrow}</p>
            <h1><span>{brand.content.hero_title}</span><em>{brand.content.hero_highlight}</em></h1>
            <p className={styles.heroDescription}>{brand.content.hero_description}</p>
            <div className={styles.ctaGroup}><a className={styles.primaryButton} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a><a className={styles.secondaryButton} href="#offers">瀏覽課程</a></div>
            <div className={styles.courseProof}><span><strong>{brand.events.length || brand.services.length}</strong>門開放內容</span><span><strong>24H</strong>線上查看</span><span><strong>1 處</strong>管理報名紀錄</span></div>
          </div>
          <figure className={styles.heroImage}><BrandImage src={brand.content.hero_image_url} alt={`${brand.name} 線上學習情境`} priority sizes="(max-width: 760px) 100vw, 48vw" /><figcaption>LEARN · PRACTICE · GROW</figcaption></figure>
        </section>
        <section className={styles.offers} id="offers">
          <header><p className={styles.eyebrow}>COURSE CATALOG</p><h2>{brand.content.section_title}</h2><p>{brand.content.section_description}</p></header>
          <OfferRows brand={brand} mode="education" />
        </section>
        <TrustStrip brand={brand} labels={["課程設計", "學習方式", "課後支援"]} />
        <SharedAbout brand={brand} eyebrow="WHY THIS PROGRAM" />
      </main>
      <PublicFooter brand={brand} />
    </div>
  );
}

function FitnessBrandPage({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={`${styles.page} ${styles.fitness}`} id="top">
      <PublicHeader brand={brand} />
      <main>
        <section className={styles.studioHero}>
          <BrandImage src={brand.content.hero_image_url} alt={`${brand.name} 教室與訓練情境`} priority sizes="100vw" />
          <div className={styles.studioShade} />
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{brand.content.hero_eyebrow}</p>
            <h1><span>{brand.content.hero_title}</span><em>{brand.content.hero_highlight}</em></h1>
            <p className={styles.heroDescription}>{brand.content.hero_description}</p>
            <div className={styles.ctaGroup}><a className={styles.primaryButton} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a><a className={styles.secondaryButton} href="#offers">查看本期課表</a></div>
          </div>
          <div className={styles.studioMeta}><span>PRIVATE SESSION</span><span>GROUP CLASS</span><span>ALL LEVELS</span></div>
        </section>
        <section className={styles.offers} id="offers">
          <header><p className={styles.eyebrow}>CLASS SCHEDULE</p><h2>{brand.content.section_title}</h2><p>{brand.content.section_description}</p></header>
          <OfferRows brand={brand} mode="fitness" />
        </section>
        <TrustStrip brand={brand} labels={["專業引導", "彈性節奏", "安心開始"]} />
        <SharedAbout brand={brand} eyebrow="THE STUDIO" />
      </main>
      <PublicFooter brand={brand} />
    </div>
  );
}

export function LiveBrandPage({ brand }: { brand: PublicBrandPageData }) {
  if (["beauty", "wellness", "pet-care"].includes(brand.template)) return <BeautyBrandPage brand={brand} />;
  if (["fitness", "venue", "event"].includes(brand.template)) return <FitnessBrandPage brand={brand} />;
  return <EducationBrandPage brand={brand} />;
}
