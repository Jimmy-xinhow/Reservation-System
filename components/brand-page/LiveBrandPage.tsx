import Image from "next/image";
import type { PublicBrandPageData } from "@/lib/brand-page";
import styles from "./LiveBrandPage.module.css";

type PageMode = "beauty" | "education" | "fitness";

const headingSegmenter = new Intl.Segmenter("zh-Hant", { granularity: "word" });
const headingSuffixes = new Set(["的", "了", "著", "過", "時", "前", "後", "中", "內", "外"]);
const headingPunctuation = /^[，。！？；：、,.!?;:）】》」』]$/u;

function headingPhrases(text: string): string[] {
  if (!/\p{Script=Han}/u.test(text)) return [text];
  const tokens = Array.from(headingSegmenter.segment(text), ({ segment }) => segment).filter((segment) => segment.trim());
  const phrases: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (headingPunctuation.test(token) && phrases.length > 0) {
      phrases[phrases.length - 1] += token;
      continue;
    }

    if ([...token].length === 1 && headingSuffixes.has(token) && phrases.length > 0) {
      phrases[phrases.length - 1] += token;
      continue;
    }

    const next = tokens[index + 1];
    if ([...token].length === 1 && next && !headingPunctuation.test(next)) {
      tokens[index + 1] = token + next;
      continue;
    }

    phrases.push(token);
  }

  return phrases;
}

function HeadingText({ text }: { text: string }) {
  return <>{headingPhrases(text).map((phrase, index) => <span className={styles.headingPhrase} key={`${phrase}-${index}`}>{phrase}</span>)}</>;
}

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
  const modeLabel = mode === "beauty" ? "從理解開始的細節照護" : mode === "education" ? "讓學習真正變成成果" : "從穩定開始建立力量";
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
      <a className={styles.backToTop} href="#top">回到頁首 ↑</a>
    </footer>
  );
}

function BeautyHeader({ brand }: { brand: PublicBrandPageData }) {
  return (
    <header className={styles.beautyHeader}>
      <a className={styles.beautyMark} href="#top"><BrandMark brand={brand} /></a>
      <nav aria-label="美學所頁面導覽">
        <a href="#principles"><span>01</span>服務方式</a>
        <a href="#offers"><span>02</span>服務項目</a>
        <a href="#about"><span>03</span>關於品牌</a>
      </nav>
      <a className={styles.beautyHeaderAction} href={brand.links.primary}>{brand.content.primary_cta_label} <span aria-hidden="true">→</span></a>
    </header>
  );
}

function BeautyOfferIndex({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={styles.beautyOfferIndex}>
      <div className={styles.beautyTableHead}><span>服務項目</span><span>服務說明</span><span>預約</span></div>
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
            <h1><HeadingText text={brand.content.hero_title} /><em><HeadingText text={brand.content.hero_highlight} /></em></h1>
            <p className={styles.beautyLead}>{brand.content.hero_description}</p>
            <div className={styles.beautyActions}>
              <a className={styles.beautyPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">→</span></a>
              <a className={styles.beautyTextLink} href="#offers">先查看療程索引 <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <figure className={styles.beautyHeroImage}>
            <BrandImage src={brand.content.hero_image_url} alt={`${brand.name} 肌膚照護情境`} priority sizes="(max-width: 760px) 100vw, 58vw" />
            <figcaption><span>一對一照護</span><span>{brand.address ?? "採預約制"}</span></figcaption>
          </figure>
          <aside className={styles.beautyEditorialNote}><span>初次到訪</span><p>先理解你的需求，再一起決定適合的照護方式。</p></aside>
        </section>

        <section className={styles.beautyPrinciples} id="principles" aria-label="服務原則">
          <p>我們重視的事</p>
          <div>{principles.map((point, index) => <p key={point}><span>{String(index + 1).padStart(2, "0")}</span><strong>{point}</strong></p>)}</div>
        </section>

        <section className={styles.beautyMenu} id="offers">
          <header>
            <p className={styles.beautyEyebrow}>服務與可約時段</p>
            <h2><HeadingText text={brand.content.section_title} /></h2>
            <p>{brand.content.section_description}</p>
          </header>
          <BeautyOfferIndex brand={brand} />
        </section>

        <section className={styles.beautyMethod} id="about">
          <figure><BrandImage src={brand.content.gallery_image_url} alt={`${brand.name} 照護細節`} sizes="(max-width: 760px) 100vw, 46vw" /></figure>
          <div className={styles.beautyMethodCopy}>
            <span className={styles.beautySectionNumber}>關於服務方式</span>
            <h2><HeadingText text={brand.content.about_title} /></h2>
            <p>{brand.content.about_description}</p>
            <dl>
              <div><dt>預約方式</dt><dd>線上查看真實可約時段</dd></div>
              <div><dt>紀錄管理</dt><dd><a href={brand.links.records}>查看我的預約紀錄 ↗</a></dd></div>
              <div><dt>服務地點</dt><dd>{brand.address ?? "預約完成後確認"}</dd></div>
            </dl>
          </div>
        </section>

        <section className={styles.beautyClosing}>
          <span>準備開始預約</span>
          <h2><HeadingText text={brand.content.secondary_cta_label} /></h2>
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
      <div className={styles.editionTag}>本期線上課程</div>
      <a className={styles.educationMark} href="#top"><BrandMark brand={brand} /></a>
      <nav aria-label="學習所頁面導覽"><a href="#offers">課程索引</a><a href="#method">學習方式</a><a href={brand.links.records}>報名紀錄</a></nav>
      <a className={styles.educationHeaderAction} href={brand.links.primary}>{brand.content.primary_cta_label} <span aria-hidden="true">→</span></a>
    </header>
  );
}

function EducationCatalog({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={styles.educationCatalog}>
      {offersFor(brand, "education").map((offer, index) => (
        <a href={offer.href} key={`${offer.id}-${index}`}>
          <span className={styles.educationIndex}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.educationType}>{offer.kind === "event" ? "課程報名" : "一對一課程"}</span>
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
          <div className={styles.educationHeroNumber}>本期精選<span>線上學習</span></div>
          <div className={styles.educationHeroCopy}>
            <p className={styles.educationEyebrow}>{brand.content.hero_eyebrow}</p>
            <h1><HeadingText text={brand.content.hero_title} /><em><HeadingText text={brand.content.hero_highlight} /></em></h1>
            <p>{brand.content.hero_description}</p>
            <div className={styles.educationActions}>
              <a className={styles.educationPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<span aria-hidden="true">↗</span></a>
              <a className={styles.educationTextLink} href="#offers">閱讀本期課綱 <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <figure className={styles.educationHeroImage}>
            <BrandImage src={brand.content.hero_image_url} alt={`${brand.name} 成人線上學習情境`} priority sizes="(max-width: 760px) 100vw, 48vw" />
            <figcaption>學習 · 練習 · 完成</figcaption>
          </figure>
          <div className={styles.educationFacts}>
            <p><span>{contentCount || "—"}</span>目前開放內容</p>
            <p><span>線上</span>查看報名狀態</p>
            <p><span>同一處</span>管理學習紀錄</p>
          </div>
        </section>

        <section className={styles.educationCourses} id="offers">
          <header>
            <span>目前開放 {String(Math.max(contentCount, 1)).padStart(2, "0")} 項</span>
            <h2><HeadingText text={brand.content.section_title} /></h2>
            <p>{brand.content.section_description}</p>
          </header>
          <EducationCatalog brand={brand} />
        </section>

        <section className={styles.educationMethod} id="method">
          <div className={styles.educationMethodIntro}>
            <p>報名與學習流程</p>
            <h2><HeadingText text="不是把內容塞滿，而是讓每一步都有方向。" /></h2>
          </div>
          <ol>{principles.map((point, index) => <li key={point}><span>0{index + 1}</span><strong>{point}</strong><p>{index === 0 ? "選擇適合的課程與場次。" : index === 1 ? "完成必要的報名與付款。" : "依資格進入教材與紀錄。"}</p></li>)}</ol>
        </section>

        <section className={styles.educationAbout} id="about">
          <figure><BrandImage src={brand.content.gallery_image_url} alt={`${brand.name} 課程實作情境`} sizes="(max-width: 760px) 100vw, 44vw" /></figure>
          <div>
            <span>課程學習方式</span>
            <h2><HeadingText text={brand.content.about_title} /></h2>
            <p>{brand.content.about_description}</p>
            <a href={brand.links.records}>已報名？查看我的學習紀錄 <b aria-hidden="true">↗</b></a>
          </div>
        </section>

        <section className={styles.educationFaq}>
          <header><span>常見問題</span><h2><HeadingText text="報名前，先把重要的事情說清楚。" /></h2></header>
          <div>
            <details><summary>{brand.content.faq_1_question}<span>＋</span></summary><p>{brand.content.faq_1_answer}</p></details>
            <details><summary>{brand.content.faq_2_question}<span>＋</span></summary><p>{brand.content.faq_2_answer}</p></details>
          </div>
        </section>

        <section className={styles.educationClosing}>
          <span>下一期課程</span>
          <h2><HeadingText text={brand.content.secondary_cta_label} /></h2>
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
      <a className={styles.fitnessHeaderAction} href={brand.links.primary}>{brand.content.primary_cta_label} <span aria-hidden="true">→</span></a>
    </header>
  );
}

function FitnessSchedule({ brand }: { brand: PublicBrandPageData }) {
  return (
    <div className={styles.fitnessSchedule}>
      <div className={styles.fitnessScheduleHead}><span>序</span><span>類型</span><span>課程</span><span>內容</span><span>預約</span></div>
      {offersFor(brand, "fitness").map((offer, index) => (
        <a href={offer.href} key={`${offer.id}-${index}`}>
          <span className={styles.fitnessClassIndex}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.fitnessType}>{offer.kind === "event" ? "團體課" : "私人課"}</span>
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
          <div className={styles.fitnessHeroCopy}>
            <p>{brand.content.hero_eyebrow}</p>
            <h1><HeadingText text={brand.content.hero_title} /><em><HeadingText text={brand.content.hero_highlight} /></em></h1>
            <span>{brand.content.hero_description}</span>
            <div className={styles.fitnessActions}>
              <a className={styles.fitnessPrimary} href={brand.links.primary}>{brand.content.primary_cta_label}<b aria-hidden="true">→</b></a>
              <a className={styles.fitnessOutline} href="#offers">查看本期課表</a>
            </div>
          </div>
          <figure className={styles.fitnessHeroMedia}>
            <BrandImage src={brand.content.hero_image_url} alt={`${brand.name} Reformer 訓練情境`} priority sizes="(max-width: 820px) 100vw, 56vw" />
            <figcaption className={styles.fitnessHeroRail}><span>器械皮拉提斯</span><span>私人課與團體課</span><span>各程度皆可開始</span></figcaption>
          </figure>
          <a className={styles.fitnessScroll} href="#offers">查看課表 ↓</a>
        </section>

        <section className={styles.fitnessClasses} id="offers">
          <header>
            <div>
              <span>CLASS SELECTION · 本期開放</span>
              <h2><HeadingText text={brand.content.section_title} /></h2>
            </div>
            <p>{brand.content.section_description}<br />選擇適合的課型後，再查看真正可預約的時間與名額。</p>
          </header>
          <FitnessSchedule brand={brand} />
        </section>

        <section className={styles.fitnessMethod} id="method">
          <figure>
            <BrandImage src={brand.content.detail_image_url} alt={`${brand.name} 教練帶領與器械細節`} sizes="(max-width: 820px) 100vw, 48vw" />
            <figcaption>專注動作品質，也保留每個人的節奏。</figcaption>
          </figure>
          <div className={styles.fitnessMethodCopy}>
            <span>THE STUDIO METHOD · 訓練方式</span>
            <h2><HeadingText text="先理解身體，再安排適合的練習。" /></h2>
            <p>{brand.content.about_description}</p>
            <ol>{principles.map((point, index) => <li key={point}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{point}</h3><p>{index === 0 ? "依你的經驗、身體狀況與目標選擇合適入口。" : index === 1 ? "私人課與團體課分開呈現可用時段與剩餘名額。" : "預約、報名、付款與上課紀錄都能在同一處查看。"}</p></div></li>)}</ol>
          </div>
        </section>

        <section className={styles.fitnessStart} id="about">
          <header>
            <span>CHOOSE YOUR START · 選擇開始方式</span>
            <h2><HeadingText text={brand.content.about_title} /></h2>
          </header>
          <div className={styles.fitnessStartRoutes}>
            {brand.links.booking && <a href={brand.links.booking}>
              <span>01 / PRIVATE</span>
              <h3>私人課與體態評估</h3>
              <p>依需求選擇服務與教練，再查看個別可約時段。</p>
              <b>查看私人課時段 <i aria-hidden="true">→</i></b>
            </a>}
            {brand.links.registration && <a href={brand.links.registration}>
              <span>02 / GROUP</span>
              <h3>團體課與主題場次</h3>
              <p>一次看懂日期、時間、剩餘名額與可使用票種。</p>
              <b>查看團體課場次 <i aria-hidden="true">→</i></b>
            </a>}
          </div>
          <aside>
            <figure><BrandImage src={brand.content.gallery_image_url} alt={`${brand.name} 教室空間`} sizes="(max-width: 820px) 100vw, 38vw" /></figure>
            <dl>
              <div><dt>適合對象</dt><dd>初學者到持續練習者</dd></div>
              <div><dt>課程形式</dt><dd>私人課／團體課</dd></div>
              <div><dt>上課地點</dt><dd>{brand.address ?? "預約時確認"}</dd></div>
            </dl>
          </aside>
        </section>

        <section className={styles.fitnessClosing}>
          <p>從適合自己的方式開始</p>
          <h2><HeadingText text={brand.content.secondary_cta_label} /></h2>
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
