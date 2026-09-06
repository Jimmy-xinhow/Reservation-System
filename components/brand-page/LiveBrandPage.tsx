import Image from "next/image";
import type { PublicBrandPageData } from "@/lib/brand-page";
import styles from "./LiveBrandPage.module.css";

type PageMode = "beauty" | "education" | "fitness";

interface PublicOffer {
  id: string;
  title: string;
  description: string;
  href: string;
  kind: "service" | "event";
}

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
  if (!event.nextSessionAt) return event.description ?? "查看內容、場次與名額";
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

function offersFor(brand: PublicBrandPageData, mode: PageMode): PublicOffer[] {
  const events: PublicOffer[] = brand.events.map((event) => ({
    id: event.id,
    title: event.title,
    description: eventMeta(event),
    href: eventHref(brand, event.slug),
    kind: "event",
  }));
  const services: PublicOffer[] = brand.services.map((service) => ({
    id: service.id,
    title: service.name,
    description: service.description ?? (mode === "beauty" ? "查看療程說明、服務人員與可約時間" : "查看內容與可預約時段"),
    href: brand.links.booking ?? brand.links.primary,
    kind: "service",
  }));
  const combined = mode === "education" ? [...events, ...services] : [...services, ...events];
  if (combined.length > 0) return combined.slice(0, 6);
  return [{
    id: "default",
    title: brand.content.section_title,
    description: brand.content.section_description,
    href: brand.links.primary,
    kind: mode === "education" ? "event" : "service",
  }];
}

function BrandMark({ brand }: { brand: PublicBrandPageData }) {
  if (!brand.logoUrl) return <span>{brand.name}</span>;
  return (
    // Brand-managed HTTPS logos cannot use next/image without a fixed remote host allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logoUrl} alt={brand.name} />
  );
}

function BrandFooter({ brand, mode }: { brand: PublicBrandPageData; mode: PageMode }) {
  const modeLabel = mode === "beauty" ? "CARE, WITH INTENTION." : mode === "education" ? "KEEP CURIOSITY OPEN." : "MOVE WITH CONTROL.";
  return (
    <footer className={`${styles.brandFooter} ${styles[`${mode}Footer`]}`}>
      <div className={styles.footerIdentity}>
        <a href="#top" aria-label={`${brand.name} 回到頁首`}><BrandMark brand={brand} /></a>
        <span>{modeLabel}</span>
      </div>
      <div className={styles.footerContact}>
        <span>{brand.address ?? "線上服務"}</span>
        {brand.phone && <a href={`tel:${brand.phone}`}>{brand.phone}</a>}
        {brand.links.line && <a href={brand.links.line}>官方 LINE ↗</a>}
        <a href={brand.links.records}>我的紀錄 ↗</a>
      </div>
      <a className={styles.backToTop} href="#top">TOP ↑</a>
    </footer>
  );
}

function BeautyHeader({ brand }: { brand: PublicBrandPageData }) {
  return (
    <header className={styles.beautyHeader}>
      <a className={styles.beautyMark} href="#top"><BrandMark brand={brand} /></a>
      <nav aria-label="美學所頁面導覽">
        <a href="#principles"><span>01</span>照護原則</a>
        <a href="#offers"><span>02</span>療程索引</a>
        <a href="#about"><span>03</span>認識空間</a>
      </nav>
      <a className={styles.beautyHeaderAction} href={brand.links.primary}>預約諮詢 <span aria-hidden="true">→</span></a>
    </header>
  );
}

function BeautyOfferIndex({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={styles.beautyOfferIndex}>
      <div className={styles.beautyTableHead}><span>療程</span><span>內容</span><span>下一步</span></div>
      {offersFor(brand, "beauty").map((offer, index) => (
        <a href={offer.href} key={`${offer.id}-${index}`}>
          <span className={styles.beautyOfferTitle}><small>{String(index + 1).padStart(2, "0")}</small><strong>{offer.title}</strong></span>
          <span className={styles.beautyOfferDescription}>{offer.description}</span>
          <span className={styles.beautyOfferAction}>{offer.kind === "service" ? "查看可約時段" : "查看開放場次"}<b aria-hidden="true">↗</b></span>
        </a>
      ))}
    </div>
  );
}

function BeautyBrandPage({ brand }: { brand: PublicBrandPageData }) {
  const principles = [brand.content.trust_point_1, brand.content.trust_point_2, brand.content.trust_point_3];
  return (
    <div className={`${styles.page} ${styles.beauty}`} id="top">
      <BeautyHeader brand={brand} />
      <main>
        <section className={styles.beautyHero}>
          <div className={styles.beautyHeroCopy}>
            <p className={styles.beautyEyebrow}>{brand.content.hero_eyebrow}</p>
            <h1>{brand.content.hero_title}<em>{brand.content.hero_highlight}</em></h1>
            <p className={styles.beautyLead}>{brand.content.hero_description}</p>
            <div className={styles.beautyActions}>
              <a className={styles.beautyPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
              <a className={styles.beautyTextLink} href="#offers">先查看療程索引 <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <figure className={styles.beautyHeroImage}>
            <BrandImage src={brand.content.hero_image_url} alt={`${brand.name} 肌膚照護情境`} priority sizes="(max-width: 760px) 100vw, 58vw" />
            <figcaption><span>PRIVATE CARE</span><span>{brand.address ?? "BY APPOINTMENT"}</span></figcaption>
          </figure>
          <aside className={styles.beautyEditorialNote}><span>NOTE / 01</span><p>先理解你的需求，再一起決定適合的照護方式。</p></aside>
        </section>

        <section className={styles.beautyPrinciples} id="principles" aria-label="服務原則">
          <p>CARE STANDARD</p>
          <div>{principles.map((point, index) => <p key={point}><span>{String(index + 1).padStart(2, "0")}</span><strong>{point}</strong></p>)}</div>
        </section>

        <section className={styles.beautyMenu} id="offers">
          <header>
            <p className={styles.beautyEyebrow}>TREATMENT INDEX</p>
            <h2>{brand.content.section_title}</h2>
            <p>{brand.content.section_description}</p>
          </header>
          <BeautyOfferIndex brand={brand} />
        </section>

        <section className={styles.beautyMethod} id="about">
          <figure><BrandImage src={brand.content.gallery_image_url} alt={`${brand.name} 照護細節`} sizes="(max-width: 760px) 100vw, 46vw" /></figure>
          <div className={styles.beautyMethodCopy}>
            <span className={styles.beautySectionNumber}>03 / OUR APPROACH</span>
            <h2>{brand.content.about_title}</h2>
            <p>{brand.content.about_description}</p>
            <dl>
              <div><dt>預約方式</dt><dd>線上查看真實可約時段</dd></div>
              <div><dt>紀錄管理</dt><dd><a href={brand.links.records}>查看我的預約紀錄 ↗</a></dd></div>
              <div><dt>服務地點</dt><dd>{brand.address ?? "預約完成後確認"}</dd></div>
            </dl>
          </div>
        </section>

        <section className={styles.beautyClosing}>
          <span>BOOKING NOTE</span>
          <h2>{brand.content.secondary_cta_label}</h2>
          <p>選好服務之後，系統會帶你查看目前仍可預約的時間，不需要來回等待確認。</p>
          <a className={styles.beautyPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
        </section>
      </main>
      <BrandFooter brand={brand} mode="beauty" />
      <a className={`${styles.mobileAction} ${styles.beautyMobileAction}`} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
    </div>
  );
}

function EducationHeader({ brand }: { brand: PublicBrandPageData }) {
  return (
    <header className={styles.educationHeader}>
      <div className={styles.editionTag}>PUBLIC PROGRAM / 2026</div>
      <a className={styles.educationMark} href="#top"><BrandMark brand={brand} /></a>
      <nav aria-label="學習所頁面導覽"><a href="#offers">課程索引</a><a href="#method">學習方式</a><a href={brand.links.records}>報名紀錄</a></nav>
      <a className={styles.educationHeaderAction} href={brand.links.primary}>探索課程 <span aria-hidden="true">↗</span></a>
    </header>
  );
}

function EducationCatalog({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={styles.educationCatalog}>
      {offersFor(brand, "education").map((offer, index) => (
        <a href={offer.href} key={`${offer.id}-${index}`}>
          <span className={styles.educationIndex}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.educationType}>{offer.kind === "event" ? "COHORT / EVENT" : "COURSE / SESSION"}</span>
          <span className={styles.educationOfferCopy}><strong>{offer.title}</strong><small>{offer.description}</small></span>
          <span className={styles.educationOfferAction}>查看內容與場次 <b aria-hidden="true">→</b></span>
        </a>
      ))}
    </div>
  );
}

function EducationBrandPage({ brand }: { brand: PublicBrandPageData }) {
  const principles = [brand.content.trust_point_1, brand.content.trust_point_2, brand.content.trust_point_3];
  const contentCount = brand.events.length + brand.services.length;
  return (
    <div className={`${styles.page} ${styles.education}`} id="top">
      <EducationHeader brand={brand} />
      <main>
        <section className={styles.educationHero}>
          <div className={styles.educationHeroNumber}>OPEN<br />ROOM<span>ISSUE 01</span></div>
          <div className={styles.educationHeroCopy}>
            <p className={styles.educationEyebrow}>{brand.content.hero_eyebrow}</p>
            <h1>{brand.content.hero_title}<em>{brand.content.hero_highlight}</em></h1>
            <p>{brand.content.hero_description}</p>
            <div className={styles.educationActions}>
              <a className={styles.educationPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">↗</span></a>
              <a className={styles.educationTextLink} href="#offers">閱讀本期課綱 <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <figure className={styles.educationHeroImage}>
            <BrandImage src={brand.content.hero_image_url} alt={`${brand.name} 成人線上學習情境`} priority sizes="(max-width: 760px) 100vw, 48vw" />
            <figcaption>LEARN / PRACTICE / GROW</figcaption>
          </figure>
          <div className={styles.educationFacts}>
            <p><span>{contentCount || "—"}</span>目前開放內容</p>
            <p><span>線上</span>查看報名狀態</p>
            <p><span>同一處</span>管理學習紀錄</p>
          </div>
        </section>

        <section className={styles.educationCourses} id="offers">
          <header>
            <span>INDEX / 01—{String(Math.max(contentCount, 1)).padStart(2, "0")}</span>
            <h2>{brand.content.section_title}</h2>
            <p>{brand.content.section_description}</p>
          </header>
          <EducationCatalog brand={brand} />
        </section>

        <section className={styles.educationMethod} id="method">
          <div className={styles.educationMethodIntro}>
            <p>HOW IT WORKS</p>
            <h2>不是把內容塞滿，<br />而是讓每一步都有方向。</h2>
          </div>
          <ol>{principles.map((point, index) => <li key={point}><span>0{index + 1}</span><strong>{point}</strong><p>{index === 0 ? "選擇適合的課程與場次。" : index === 1 ? "完成必要的報名與付款。" : "依資格進入教材與紀錄。"}</p></li>)}</ol>
        </section>

        <section className={styles.educationAbout} id="about">
          <figure><BrandImage src={brand.content.gallery_image_url} alt={`${brand.name} 課程實作情境`} sizes="(max-width: 760px) 100vw, 44vw" /></figure>
          <div>
            <span>FIELD NOTES / 02</span>
            <h2>{brand.content.about_title}</h2>
            <p>{brand.content.about_description}</p>
            <a href={brand.links.records}>已報名？查看我的學習紀錄 <b aria-hidden="true">↗</b></a>
          </div>
        </section>

        <section className={styles.educationFaq}>
          <header><span>FAQ / 03</span><h2>報名前，先把重要的事情說清楚。</h2></header>
          <div>
            <details><summary>{brand.content.faq_1_question}<span>＋</span></summary><p>{brand.content.faq_1_answer}</p></details>
            <details><summary>{brand.content.faq_2_question}<span>＋</span></summary><p>{brand.content.faq_2_answer}</p></details>
          </div>
        </section>

        <section className={styles.educationClosing}>
          <span>NEXT COHORT</span>
          <h2>{brand.content.secondary_cta_label}</h2>
          <a className={styles.educationPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">↗</span></a>
        </section>
      </main>
      <BrandFooter brand={brand} mode="education" />
      <a className={`${styles.mobileAction} ${styles.educationMobileAction}`} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">↗</span></a>
    </div>
  );
}

function FitnessHeader({ brand }: { brand: PublicBrandPageData }) {
  return (
    <header className={styles.fitnessHeader}>
      <a className={styles.fitnessMark} href="#top"><BrandMark brand={brand} /></a>
      <nav aria-label="運動教室頁面導覽"><a href="#offers">本期課表</a><a href="#method">訓練方式</a><a href={brand.links.records}>我的紀錄</a></nav>
      <a className={styles.fitnessHeaderAction} href={brand.links.primary}>BOOK A CLASS <span aria-hidden="true">↗</span></a>
    </header>
  );
}

function FitnessSchedule({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={styles.fitnessSchedule}>
      <div className={styles.fitnessScheduleHead}><span>TYPE</span><span>CLASS</span><span>DETAIL</span><span>BOOK</span></div>
      {offersFor(brand, "fitness").map((offer, index) => (
        <a href={offer.href} key={`${offer.id}-${index}`}>
          <span className={styles.fitnessType}>{offer.kind === "event" ? "GROUP" : "PRIVATE"}</span>
          <strong>{offer.title}</strong>
          <small>{offer.description}</small>
          <span className={styles.fitnessBook}>{offer.kind === "event" ? "查看場次" : "查看時段"}<b aria-hidden="true">↗</b></span>
        </a>
      ))}
    </div>
  );
}

function FitnessBrandPage({ brand }: { brand: PublicBrandPageData }) {
  const principles = [brand.content.trust_point_1, brand.content.trust_point_2, brand.content.trust_point_3];
  return (
    <div className={`${styles.page} ${styles.fitness}`} id="top">
      <FitnessHeader brand={brand} />
      <main>
        <section className={styles.fitnessHero}>
          <BrandImage src={brand.content.hero_image_url} alt={`${brand.name} Reformer 訓練情境`} priority sizes="100vw" />
          <div className={styles.fitnessHeroShade} />
          <div className={styles.fitnessHeroCopy}>
            <p>{brand.content.hero_eyebrow}</p>
            <h1>{brand.content.hero_title}<em>{brand.content.hero_highlight}</em></h1>
            <span>{brand.content.hero_description}</span>
            <div className={styles.fitnessActions}>
              <a className={styles.fitnessPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<b aria-hidden="true">→</b></a>
              <a className={styles.fitnessOutline} href="#offers">查看本期課表</a>
            </div>
          </div>
          <div className={styles.fitnessHeroRail}><span>REFORMER</span><span>PRIVATE / GROUP</span><span>ALL LEVELS</span></div>
          <a className={styles.fitnessScroll} href="#offers">SCROLL TO SCHEDULE ↓</a>
        </section>

        <section className={styles.fitnessClasses} id="offers">
          <header>
            <span>CLASS BOARD / TAIPEI</span>
            <h2>{brand.content.section_title}</h2>
            <p>{brand.content.section_description}</p>
          </header>
          <FitnessSchedule brand={brand} />
        </section>

        <section className={styles.fitnessPrinciples} id="method">
          <p>THE FORME METHOD</p>
          <div>{principles.map((point, index) => <article key={point}><span>0{index + 1}</span><h3>{point}</h3><p>{index === 0 ? "依你的經驗與目標選擇合適入口。" : index === 1 ? "私人課與團體課各自顯示真實可用時段。" : "完成後可隨時查看預約、報名與付款狀態。"}</p></article>)}</div>
        </section>

        <section className={styles.fitnessAbout} id="about">
          <div className={styles.fitnessAboutCopy}>
            <span>STUDIO / 02</span>
            <h2>{brand.content.about_title}</h2>
            <p>{brand.content.about_description}</p>
            <dl>
              <div><dt>PRIVATE</dt><dd>選擇服務與個別時段</dd></div>
              <div><dt>GROUP</dt><dd>依場次、名額與票種報名</dd></div>
              <div><dt>LOCATION</dt><dd>{brand.address ?? "預約時確認"}</dd></div>
            </dl>
          </div>
          <figure><BrandImage src={brand.content.gallery_image_url} alt={`${brand.name} 教室與器械細節`} sizes="(max-width: 760px) 100vw, 52vw" /></figure>
        </section>

        <section className={styles.fitnessClosing}>
          <p>START WHERE YOU ARE.</p>
          <h2>{brand.content.secondary_cta_label}</h2>
          <div><a className={styles.fitnessPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<b aria-hidden="true">→</b></a><a href={brand.links.records}>查看我的紀錄 ↗</a></div>
        </section>
      </main>
      <BrandFooter brand={brand} mode="fitness" />
      <a className={`${styles.mobileAction} ${styles.fitnessMobileAction}`} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
    </div>
  );
}

export function LiveBrandPage({ brand }: { brand: PublicBrandPageData }) {
  if (["beauty", "wellness", "pet-care"].includes(brand.template)) return <BeautyBrandPage brand={brand} />;
  if (["fitness", "venue", "event"].includes(brand.template)) return <FitnessBrandPage brand={brand} />;
  return <EducationBrandPage brand={brand} />;
}
