import Image from "next/image";
import Link from "next/link";
import { SHOWCASE_TEMPLATES, type ShowcaseSlug } from "@/lib/showcase-templates";
import type { PublicBrandPageData } from "@/lib/brand-page";
import styles from "./showcase.module.css";

type LiveProps = { brand?: PublicBrandPageData };

function ShowcaseImage({ src, alt, priority = false, sizes }: { src: string; alt: string; priority?: boolean; sizes: string }) {
  if (src.startsWith("/")) return <Image src={src} alt={alt} fill priority={priority} sizes={sizes} />;
  return (
    // Brand-managed HTTPS artwork cannot use next/image without a fixed remote host allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} className={styles.runtimeImage} />
  );
}

function BrandWordmark({ brand, children }: { brand?: PublicBrandPageData; children: React.ReactNode }) {
  if (!brand) return children;
  if (!brand.logoUrl) return brand.name;
  return (
    // Brand-managed HTTPS artwork cannot use next/image without a fixed remote host allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logoUrl} alt={brand.name} className={styles.runtimeLogo} />
  );
}

function LiveReviewBar({ slug, brand }: { slug: ShowcaseSlug; brand?: PublicBrandPageData }) {
  return brand ? null : <ReviewBar slug={slug} />;
}

function eventHref(brand: PublicBrandPageData | undefined, eventSlug: string): string {
  if (!brand?.links.registration) return brand?.links.primary ?? "#";
  const query = brand.links.registration.split("?")[1];
  return `/register/event/${encodeURIComponent(eventSlug)}${query ? `?${query}` : ""}`;
}

function eventMeta(event: PublicBrandPageData["events"][number]): string {
  if (!event.nextSessionAt) return event.description ?? "查看場次、票種、名額與報名資訊";
  const when = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.nextSessionAt));
  const capacity = event.nextSessionCapacity ? ` · 容量 ${event.nextSessionCapacity} 人` : "";
  return `${event.nextSessionName ?? "近期場次"} · ${when}${capacity}`;
}

function serviceRows(brand: PublicBrandPageData | undefined, fallback: string[][]): string[][] {
  if (!brand?.services.length) return fallback;
  return brand.services.slice(0, 3).map((service, index) => [
    String(index + 1).padStart(2, "0"),
    service.name,
    service.description ?? "查看服務內容與可預約時段",
    "查看時段",
    "↗",
  ]);
}

function ReviewBar({ slug }: { slug: ShowcaseSlug }) {
  const index = SHOWCASE_TEMPLATES.findIndex((template) => template.slug === slug);
  const previous = SHOWCASE_TEMPLATES[(index - 1 + SHOWCASE_TEMPLATES.length) % SHOWCASE_TEMPLATES.length];
  const next = SHOWCASE_TEMPLATES[(index + 1) % SHOWCASE_TEMPLATES.length];
  return (
    <aside className={styles.reviewBar} aria-label="設計審稿導覽">
      <Link href="/showcase" className={styles.reviewHome}>XINHOW 設計審稿</Link>
      <span className={styles.reviewStatus}>{String(index + 1).padStart(2, "0")} / 08　{SHOWCASE_TEMPLATES[index].industry}</span>
      <nav>
        <Link href={`/showcase/${previous.slug}`} aria-label={`上一套：${previous.industry}`}>←</Link>
        <Link href={`/showcase/${next.slug}`} aria-label={`下一套：${next.industry}`}>→</Link>
      </nav>
    </aside>
  );
}

function BeautyShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  const services = serviceRows(brand, [
    ["01", "Signature Cut", "設計剪髮", "NT$ 1,800", "75 min"],
    ["02", "Tone & Dimension", "質感染髮", "NT$ 3,800 起", "150 min"],
    ["03", "Texture Reset", "結構式護理", "NT$ 2,400", "90 min"],
  ]);
  return (
    <div className={styles.beauty} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="beauty" brand={brand} />
      <header className={styles.beautyNav}>
        {brand ? <a href={brand.links.records}>我的紀錄</a> : <button type="button" aria-label="開啟選單">Menu</button>}
        <Link href="#beauty-top" className={styles.beautyLogo}><BrandWordmark brand={brand}>LUNE<span>HAIR ATELIER</span></BrandWordmark></Link>
        <a href={brand?.links.primary ?? "#beauty-book"}>{content?.primary_cta_label ?? "Book an appointment"}</a>
      </header>

      <main id="beauty-top">
        <section className={styles.beautyHero}>
          <div className={styles.beautyCopy}>
            <p>{content?.hero_eyebrow ?? "TAIPEI · SINCE 2018"}</p>
            <h1>{content?.hero_title ?? "Hair,"}<br /><em>{content?.hero_highlight ?? "considered."}</em></h1>
            <div>
              <span>{content?.hero_description ?? "剪裁、色彩與護理，由髮型師從你的日常開始設計。"}</span>
              <a href={brand?.links.primary ?? "#beauty-book"}>{content?.primary_cta_label ?? "查看服務與時段"} ↗</a>
            </div>
          </div>
          <figure className={styles.beautyHeroImage}>
            <ShowcaseImage src={content?.hero_image_url ?? "/showcase/beauty-hero.jpg"} alt={`${brand?.name ?? "LUNE"} 品牌主視覺`} priority sizes="(max-width: 768px) 100vw, 62vw" />
            <figcaption>{brand?.name ?? "THE QUIET CUT — COLLECTION 04"}</figcaption>
          </figure>
          <span className={styles.beautyEdition}>{brand ? `${brand.name} / BRAND EDITION` : "LUNE / EDITION 04"}</span>
        </section>

        <section className={styles.beautyServices} id={brand ? "brand-page-content" : "beauty-book"}>
          <header>
            <p>Services / 服務</p>
            <h2>{content?.section_title ?? "不是選一個品項，而是找到適合你的輪廓。"}</h2>
          </header>
          <div className={styles.beautyServiceBody}>
            <div className={styles.beautyServiceList}>
              {services.map(([number, en, zh, price, time]) => (
                <a href={brand?.links.primary ?? "#"} key={number}>
                  <span>{number}</span><strong>{en}<small>{zh}</small></strong><i>{price}<small>{time}</small></i><b>↗</b>
                </a>
              ))}
            </div>
            <figure>
              <ShowcaseImage src={content?.detail_image_url ?? "/showcase/beauty-detail.jpg"} alt={`${brand?.name ?? "LUNE"} 品牌空間`} sizes="(max-width: 768px) 100vw, 36vw" />
              <figcaption>{brand?.address ? `FIND US — ${brand.address}` : "FIND US — 大安區安和路二段 27 號"}</figcaption>
            </figure>
          </div>
        </section>
      </main>
      <footer className={styles.beautyFooter}><span>{brand?.name ?? "LUNE HAIR ATELIER"}</span><span>{brand ? [brand.phone, brand.address].filter(Boolean).join("　") : "Instagram　Line　02 2700 2727"}</span></footer>
    </div>
  );
}

function WellnessShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  const fallbackSteps = [
    ["01", "先理解完整的你", "初診前填寫身體狀況、生活習慣與期待，讓第一次見面從真正重要的地方開始。"],
    ["02", "與專業團隊深度會談", "保留完整一小時，不把你的問題切成互不相干的症狀。"],
    ["03", "建立可執行的照護計畫", "從檢測、營養、睡眠到日常節奏，留下清楚的下一步。"],
  ];
  const steps = brand?.services.length
    ? brand.services.slice(0, 3).map((service, index) => [String(index + 1).padStart(2, "0"), service.name, service.description ?? "選擇後查看服務內容與可預約時段。"])
    : fallbackSteps;
  return (
    <div className={styles.wellness} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="wellness" brand={brand} />
      <header className={styles.wellnessNav}>
        <Link href="#wellness-top" className={styles.wellnessLogo}><BrandWordmark brand={brand}>沐森<span>MORROW HEALTH</span></BrandWordmark></Link>
        <nav>{brand ? <><a href="#brand-page-content">服務內容</a><a href={brand.links.records}>我的紀錄</a>{brand.links.membership && <a href={brand.links.membership}>會員方案</a>}</> : <><a href="#care">照護方式</a><a href="#team">專業團隊</a><a href="#program">方案</a></>}</nav>
        <a href={brand?.links.primary ?? "#wellness-book"}>{content?.primary_cta_label ?? "預約初次諮詢"}</a>
      </header>
      <main id="wellness-top">
        <section className={styles.wellnessHero}>
          <div className={styles.wellnessCopy}>
            <p>{content?.hero_eyebrow ?? "INTEGRATED HEALTH · TAIPEI"}</p>
            <h1>{brand ? <><span>{content?.hero_title}</span><span>{content?.hero_highlight}</span></> : <><span>把身體的訊號，</span><span>重新連成一個</span><span>完整故事。</span></>}</h1>
            <p>{content?.hero_description ?? "結合醫療專業、生活評估與長期陪伴，為複雜、反覆、難以說清楚的身體狀況，找到更有方向的照護方式。"}</p>
            <div><a id="wellness-book" href={brand?.links.primary ?? "#care"}>{content?.primary_cta_label ?? "開始初次評估"}</a><a href={brand?.links.secondary ?? "#team"}>{content?.secondary_cta_label ?? "認識照護團隊"} →</a></div>
          </div>
          <figure className={styles.wellnessHeroImage}>
            <ShowcaseImage src={content?.hero_image_url ?? "/showcase/wellness-hero.jpg"} alt={`${brand?.name ?? "沐森健康"} 品牌主視覺`} priority sizes="(max-width: 768px) 100vw, 48vw" />
            <figcaption><strong>{brand?.services.length ?? 60}</strong><span>{brand ? "項公開服務\n直接查看預約時段" : <>分鐘完整初談<br />不急著只處理一個症狀</>}</span></figcaption>
          </figure>
        </section>
        <div className={styles.wellnessTrust}>
          {brand ? <><span>線上查看時段</span><span>預約狀態可追蹤</span><span>{brand.address ?? "品牌專屬服務"}</span><span>資料安全送出</span></> : <><span>醫師主導照護</span><span>一對一完整評估</span><span>台北實體・遠距追蹤</span><span>透明方案與費用</span></>}
        </div>
        <section className={styles.wellnessJourney} id={brand ? "brand-page-content" : "care"}>
          <div className={styles.wellnessJourneyIntro}>
            <p>HOW CARE WORKS</p>
            <h2>{brand ? <span>{content?.section_title}</span> : <><span>每一步都知道，</span><span>現在為什麼做。</span></>}</h2>
            <figure><ShowcaseImage src={content?.detail_image_url ?? "/showcase/wellness-detail.jpg"} alt={`${brand?.name ?? "沐森健康"} 服務環境`} sizes="(max-width: 768px) 100vw, 32vw" /></figure>
          </div>
          <div className={styles.wellnessSteps}>
            {steps.map(([number, title, description]) => (
              <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div></article>
            ))}
            <a href={brand?.links.primary ?? "#program"}>{brand ? content?.primary_cta_label : "比較照護方案"}　→</a>
          </div>
        </section>
      </main>
    </div>
  );
}

function FitnessShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  const scheduleRows = brand?.services.length
    ? brand.services.slice(0, 3).map((service, index) => [String(index + 1).padStart(2, "0"), service.name, service.description ?? "公開服務", "查看時段"])
    : [["07:00", "FULL BODY", "NICO", "4 spots"], ["12:20", "CORE + LOWER", "MIA", "Waitlist"], ["18:40", "RUN × LIFT", "JAY", "7 spots"]];
  return (
    <div className={styles.fitness} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="fitness" brand={brand} />
      <header className={styles.fitnessNav}>
        <Link href="#fitness-top" className={styles.fitnessLogo}><BrandWordmark brand={brand}>RED<br />LINE</BrandWordmark></Link>
        <nav>{brand ? <><a href="#brand-page-content">服務內容</a>{brand.links.registration && <a href={brand.links.registration}>團體課程</a>}<a href={brand.links.records}>我的紀錄</a></> : <><a href="#workout">The workout</a><a href="#schedule">Schedule</a><a href="#coaches">Coaches</a></>}</nav>
        <a href={brand?.links.primary ?? "#schedule"}>{content?.primary_cta_label ?? "Book your first class"}</a>
      </header>
      <main id="fitness-top">
        <section className={styles.fitnessHero}>
          <ShowcaseImage src={content?.hero_image_url ?? "/showcase/fitness-hero.jpg"} alt={`${brand?.name ?? "REDLINE"} 品牌主視覺`} priority sizes="100vw" />
          <div className={styles.fitnessShade} />
          <div className={styles.fitnessHeroCopy}>
            <p>{content?.hero_eyebrow ?? "45 MINUTES · COACH LED · YOUR PACE"}</p>
            <h1>{brand ? <>{content?.hero_title}<br /><span>{content?.hero_highlight}</span></> : <>MOVE<br /><span>PAST</span><br />AVERAGE.</>}</h1>
            <div><a href={brand?.links.primary ?? "#schedule"}>{content?.primary_cta_label ?? "預約第一堂課"}</a><span>{brand ? "向下查看完整內容 ↓" : "SCROLL TO EXPLORE ↓"}</span></div>
          </div>
          <p className={styles.fitnessSideType}>{brand?.name ?? "TAIPEI’S HIGH-ENERGY TRAINING CLUB"}</p>
        </section>
        <div className={styles.fitnessTicker}>{brand ? <><span>線上預約</span><span>即時名額</span><span>依自己的節奏開始</span></> : <><span>RUN × LIFT</span><span>STRENGTH × CONTROL</span><span>MUSIC × COMMUNITY</span></>}</div>
        <section className={styles.fitnessWorkout} id={brand ? "brand-page-content" : "workout"}>
          <div className={styles.fitnessStatement}>
            <p>{brand ? "課程方式 / 01" : "THE FORMAT / 01"}</p>
            <h2>{brand ? <span>{content?.section_title}</span> : <><span>一半心肺。</span><span>一半力量。</span><i>全部由你決定。</i></>}</h2>
            <p>{content?.section_description ?? "教練掌握節奏，你掌握強度。第一次來也能清楚跟上，不需要先成為厲害的人。"}</p>
          </div>
          <figure><ShowcaseImage src={content?.detail_image_url ?? "/showcase/fitness-detail.jpg"} alt={`${brand?.name ?? "REDLINE"} 服務場地`} sizes="(max-width: 768px) 100vw, 48vw" /><figcaption>{brand?.address ?? "THE FLOOR / DAAN STUDIO"}</figcaption></figure>
        </section>
        <section className={styles.fitnessSchedule} id="schedule">
          <header><span>{brand ? "可預約服務" : "TODAY · AUG 15"}</span><h2>{brand ? "選擇適合你的服務。" : "Pick your room."}</h2><a href={brand?.links.booking ?? brand?.links.primary ?? "#"}>{brand ? "查看私人課時段" : "完整課表"} ↗</a></header>
          {scheduleRows.map((row) => (
            <a href={brand?.links.booking ?? brand?.links.primary ?? "#"} key={`${row[0]}-${row[1]}`}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><i>{row[3]}</i><b>{brand ? "查看時段 →" : "BOOK →"}</b></a>
          ))}
        </section>
      </main>
    </div>
  );
}

function EducationShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  const liveTracks = brand
    ? (brand.events.length > 0
      ? brand.events.slice(0, 2).map((event, index) => ({ number: String(index + 1).padStart(2, "0"), title: event.title, meta: eventMeta(event), href: eventHref(brand, event.slug) }))
      : brand.services.slice(0, 2).map((service, index) => ({ number: String(index + 1).padStart(2, "0"), title: service.name, meta: service.description ?? "查看內容與可預約時段", href: brand.links.primary })))
    : [];
  const tracks = liveTracks.length > 0 ? liveTracks : [
    { number: "01", title: "用一張紙，做出會動的城市", meta: "創意設計 · 8–11 歲 · 週六 10:00", href: "#" },
    { number: "02", title: "把生活寫成自己的第一本故事", meta: "創意寫作 · 10–14 歲 · 週日 14:00", href: "#" },
  ];
  return (
    <div className={styles.education} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="education" brand={brand} />
      <header className={styles.educationNav}>
        <Link href="#education-top" className={styles.educationLogo}><BrandWordmark brand={brand}>OPEN<span>ROOM</span></BrandWordmark></Link>
        <nav>{brand ? <><a href="#brand-page-content">課程內容</a><a href={brand.links.records}>我的紀錄</a>{brand.links.membership && <a href={brand.links.membership}>會員方案</a>}</> : <><a href="#explore">探索課程</a><a href="#teachers">師資</a><a href="#parents">給家長</a></>}</nav>
        <a href={brand?.links.primary ?? "#explore"}>{content?.primary_cta_label ?? "找到一堂課"}</a>
      </header>
      <main id="education-top">
        <section className={styles.educationHero}>
          <div className={styles.educationCopy}>
            <p>{content?.hero_eyebrow ?? "AFTER SCHOOL, WIDE OPEN."}</p>
            <h1><span>{content?.hero_title ?? "好奇心沒有"}</span><span>{content?.hero_highlight ?? "標準答案。"}</span></h1>
            <p>{content?.hero_description ?? "為 6–15 歲孩子設計的小班課。從動畫、自然觀察到創意寫作，讓興趣有地方繼續長大。"}</p>
          </div>
          <figure className={styles.educationHeroImage}>
            <ShowcaseImage src={content?.hero_image_url ?? "/showcase/education-hero.jpg"} alt={`${brand?.name ?? "OPENROOM"} 品牌主視覺`} priority sizes="(max-width: 768px) 100vw, 50vw" />
            <span>{brand ? `${brand.events.length || brand.services.length}\nOPEN` : <>6–15<br />YEARS</>}</span>
          </figure>
          {brand ? <div className={styles.educationSearch}>
            <label><span>目前公開內容</span><input value={`${brand.events.length} 個活動／${brand.services.length} 項服務`} readOnly /></label>
            <label><span>線上入口</span><input value="即時讀取現有系統資料" readOnly /></label>
            <Link href={brand.links.primary}>{content?.primary_cta_label ?? "探索課程"} →</Link>
          </div> : <form className={styles.educationSearch}>
            <label><span>孩子想探索什麼？</span><input type="text" placeholder="動畫、科學、寫作⋯" /></label>
            <label><span>適合年齡</span><select defaultValue=""><option value="" disabled>選擇年齡</option><option>6–8 歲</option><option>9–12 歲</option><option>13–15 歲</option></select></label>
            <button type="button">搜尋課程 →</button>
          </form>}
        </section>
        <section className={styles.educationExplore} id={brand ? "brand-page-content" : "explore"}>
          <header><p>{brand ? "目前開放報名" : "THIS WEEK AT OPENROOM"}</p><h2>{content?.section_title ?? "這週，可以從這裡開始。"}</h2></header>
          <div className={styles.educationTracks}>
            <a href={tracks[0].href}><span>{tracks[0].number}</span><strong>{tracks[0].title}</strong><small>{tracks[0].meta}</small><b>查看課程 ↗</b></a>
            <figure><ShowcaseImage src={content?.detail_image_url ?? "/showcase/education-detail.jpg"} alt={`${brand?.name ?? "OPENROOM"} 課程內容`} sizes="(max-width: 768px) 100vw, 36vw" /></figure>
            <a href={tracks[1]?.href ?? brand?.links.primary ?? "#"}><span>{tracks[1]?.number ?? "02"}</span><strong>{tracks[1]?.title ?? content?.section_title ?? "查看所有課程"}</strong><small>{tracks[1]?.meta ?? content?.section_description ?? "進入公開課程與活動列表"}</small><b>查看課程 ↗</b></a>
          </div>
        </section>
      </main>
    </div>
  );
}

function ConsultingShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  const expertise = brand?.services.length
    ? brand.services.slice(0, 3).map((service, index) => [String(index + 1).padStart(2, "0"), service.name, service.description ?? "查看合作內容與可預約時段"])
    : [["01", "Business clarity", "商業定位與機會盤點"], ["02", "Brand systems", "品牌架構與識別系統"], ["03", "Growth design", "服務體驗與成長設計"]];
  return (
    <div className={styles.consulting} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="consulting" brand={brand} />
      <header className={styles.consultingNav}>
        <Link href="#consulting-top"><BrandWordmark brand={brand}>NORTH／</BrandWordmark></Link>
        <nav>{brand ? <><a href="#brand-page-content">Services</a><a href={brand.links.records}>Records</a><a href={brand.links.line ?? brand.links.primary}>Contact</a></> : <><a href="#work">Work</a><a href="#expertise">Expertise</a><a href="#studio">Studio</a></>}</nav>
        <a href={brand?.links.primary ?? "#contact"}>{content?.primary_cta_label ?? "Start a project"} ↗</a>
      </header>
      <main id="consulting-top">
        <section className={styles.consultingHero}>
          <p>{content?.hero_eyebrow ?? "STRATEGY, BRAND & GROWTH"}</p>
          <h1>{content?.hero_title ?? "We make the complex"}<br /><em>{content?.hero_highlight ?? "clear."}</em></h1>
          <div className={styles.consultingHeroFoot}><span>{content?.hero_description ?? "為下一階段的企業，整理方向、建立定位，讓策略真正進入組織。"}</span><a href={brand?.links.secondary ?? "#work"}>{content?.secondary_cta_label ?? "Selected work"} ↓</a></div>
        </section>
        <section className={styles.consultingWork} id={brand ? "brand-page-content" : "work"}>
          <figure>
            <ShowcaseImage src={content?.hero_image_url ?? "/showcase/consulting-hero.jpg"} alt={`${brand?.name ?? "NORTH"} 品牌主視覺`} priority sizes="(max-width: 768px) 100vw, 68vw" />
            <figcaption><span>01 / ORGANISATION</span><strong>{content?.section_title ?? "把分散的服務，變成可理解的品牌架構。"}</strong></figcaption>
          </figure>
          <aside><span>{brand ? "SERVICE PROFILE" : "SELECTED CASE"}</span><strong>{brand?.name ?? "禾序建設"}</strong><p>{brand ? expertise.map((row) => row[1]).join("\n") : <>品牌策略<br />服務架構<br />數位體驗</>}</p><b>{brand ? "NOW" : "2026"}</b></aside>
        </section>
        <section className={styles.consultingExpertise} id="expertise">
          <header><p>WHAT WE DO</p><h2>{content?.section_title ?? "不同問題，需要不同深度的合作。"}</h2></header>
          <div>
            {expertise.map(([number, en, zh]) => (
              <a href={brand?.links.primary ?? "#"} key={number}><span>{number}</span><strong>{en}<small>{zh}</small></strong><b>＋</b></a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function PetCareShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  const availabilityRows = brand?.services.length
    ? brand.services.slice(0, 3).map((service, index) => ["服務", String(index + 1).padStart(2, "0"), service.name, service.description ?? "查看可預約時段"])
    : [["今天", "8 月 15 日", "18:20", "一般門診"], ["明天", "8 月 16 日", "10:40", "預防照護"], ["週一", "8 月 17 日", "09:30", "一般門診"]];
  return (
    <div className={styles.pet} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="pet-care" brand={brand} />
      <header className={styles.petNav}>
        <Link href="#pet-top" className={styles.petLogo}><BrandWordmark brand={brand}>MOMO<span>VETERINARY</span></BrandWordmark></Link>
        <nav>{brand ? <><a href="#brand-page-content">服務內容</a><a href={brand.links.records}>我的紀錄</a><a href={brand.links.line ?? brand.links.phone ?? brand.links.primary}>聯絡我們</a></> : <><a href="#services">醫療服務</a><a href="#team">獸醫團隊</a><a href="#locations">院所位置</a></>}</nav>
        <a href={brand?.links.phone ?? "tel:0227002525"}>需要協助？{brand?.phone ?? "02 2700 2525"}</a>
        <a href={brand?.links.primary ?? "#pet-book"}>{content?.primary_cta_label ?? "預約看診"}</a>
      </header>
      <main id="pet-top">
        <section className={styles.petHero}>
          <div className={styles.petCopy}>
            <p>{content?.hero_eyebrow ?? "CARE THAT FEELS CLOSER"}</p>
            <h1>{brand ? <><span>{content?.hero_title}</span><em>{content?.hero_highlight}</em></> : <><span>好好看診，</span><span>也好好對待</span><em>牠的感受。</em></>}</h1>
            <p>{content?.hero_description ?? "有時間聽你說，也讓毛孩慢慢適應。預防照護、一般門診與急症協助，都從少一點緊張開始。"}</p>
            <div><a id="pet-book" href={brand?.links.primary ?? "#availability"}>{content?.primary_cta_label ?? "查看最近時段"}</a><a href={brand?.links.secondary ?? "#services"}>{content?.secondary_cta_label ?? "了解服務"} →</a></div>
          </div>
          <figure><ShowcaseImage src={content?.hero_image_url ?? "/showcase/pet-hero.jpg"} alt={`${brand?.name ?? "MOMO"} 品牌主視覺`} priority sizes="(max-width: 768px) 100vw, 52vw" /><figcaption>{brand?.address ?? "FEAR-FREE FRIENDLY SPACE"}</figcaption></figure>
        </section>
        <div className={styles.petTrust}>{brand ? <><strong>BOOK</strong><span>線上預約</span><strong>TRACK</strong><span>狀態可追蹤</span><strong>LINE</strong><span>品牌聯絡入口</span></> : <><strong>AAHA</strong><span>國際照護標準</span><strong>24/7</strong><span>會員線上諮詢</span><strong>30 MIN</strong><span>不超收的門診時間</span></>}</div>
        <section className={styles.petAvailability} id={brand ? "brand-page-content" : "availability"}>
          <header><p>AVAILABLE APPOINTMENTS</p><h2>{content?.section_title ?? "最快可以什麼時候來？"}</h2><span>{brand?.address ?? "大安院 · 台北市大安區"}</span></header>
          <div className={`${styles.petTimes} ${brand ? styles.petLiveTimes : ""}`}>
            {availabilityRows.map(([day, date, time, service]) => (
              <a href={brand?.links.primary ?? "#"} key={`${date}-${time}`}><span>{day}<small>{date}</small></span><strong>{time}</strong><i>{service}</i><b>選擇 →</b></a>
            ))}
          </div>
          <figure><ShowcaseImage src={content?.detail_image_url ?? "/showcase/pet-detail.jpg"} alt={`${brand?.name ?? "MOMO"} 服務環境`} sizes="(max-width: 768px) 100vw, 28vw" /></figure>
        </section>
      </main>
    </div>
  );
}

function VenueShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  return (
    <div className={styles.venue} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="venue" brand={brand} />
      <header className={styles.venueNav}>
        <Link href="#venue-top"><BrandWordmark brand={brand}>ROOM <span>21</span></BrandWordmark></Link>
        <nav>{brand ? <><a href="#brand-page-content">The space</a><a href={brand.links.records}>My records</a><a href={brand.links.line ?? brand.links.phone ?? brand.links.primary}>Contact</a></> : <><a href="#space">The space</a><a href="#details">Details</a><a href="#access">Access</a></>}</nav>
        <a href={brand?.links.primary ?? "#availability"}>{content?.primary_cta_label ?? "Check availability"}</a>
      </header>
      <main id="venue-top">
        <section className={styles.venueHero}>
          <ShowcaseImage src={content?.hero_image_url ?? "/showcase/space-detail.jpg"} alt={`${brand?.name ?? "ROOM 21"} 品牌主視覺`} priority sizes="100vw" />
          <div className={styles.venueShade} />
          <div className={styles.venueTitle}>
            <p>{content?.hero_eyebrow ?? "PRIVATE CREATIVE SPACE · TAIPEI"}</p>
            <h1>{content?.hero_title ?? "A space built"}<br /><em>{content?.hero_highlight ?? "for almost anything."}</em></h1>
          </div>
          {brand ? <div className={styles.venueSearch} id="availability">
            <label><span>公開服務</span><input value={`${brand.services.length} 項可預約服務`} readOnly /></label>
            <label><span>品牌位置</span><input value={brand.address ?? "預約後提供完整資訊"} readOnly /></label>
            <label><span>預約方式</span><input value="線上查看真實時段" readOnly /></label>
            <Link href={brand.links.primary}>{content?.primary_cta_label ?? "查看時段"} →</Link>
          </div> : <form className={styles.venueSearch} id="availability">
            <label><span>用途</span><select defaultValue=""><option value="" disabled>拍攝／聚會／工作坊</option><option>商業拍攝</option><option>品牌活動</option><option>工作坊</option></select></label>
            <label><span>日期</span><input type="date" defaultValue="2026-08-22" /></label>
            <label><span>人數</span><select defaultValue="12"><option value="12">12 人</option><option value="20">20 人</option><option value="30">30 人</option></select></label>
            <button type="button">查看時段 →</button>
          </form>}
        </section>
        <div className={styles.venueFacts}>{brand ? <><span><strong>{brand.services.length}</strong> SERVICES</span><span><strong>ONLINE</strong> BOOKING</span><span><strong>REAL</strong> AVAILABILITY</span><span><strong>SAFE</strong> RECORDS</span></> : <><span><strong>45</strong> PPL</span><span><strong>1,300</strong> SQ FT</span><span><strong>24/7</strong> ACCESS</span><span><strong>NT$2,800</strong> / HR</span></>}</div>
        <section className={styles.venueStory} id={brand ? "brand-page-content" : "space"}>
          <header><p>THE SPACE / 01</p><h2>{content?.section_title ?? "自然光、完整設備，以及不被打擾的時間。"}</h2></header>
          <div><p>{content?.section_description ?? "位於台北市中心的獨立空間。可依拍攝、課程、私人聚會調整陳設，所有價格與設備在預約前一次說清楚。"}</p><a href={brand?.links.primary ?? "#details"}>{content?.primary_cta_label ?? "查看完整設備清單"} ↗</a></div>
          <figure><ShowcaseImage src={content?.detail_image_url ?? "/showcase/space-hero.jpg"} alt={`${brand?.name ?? "ROOM 21"} 空間細節`} sizes="(max-width: 768px) 100vw, 44vw" /><figcaption>{brand?.address ?? "WEST ROOM · 74 M²"}</figcaption></figure>
        </section>
      </main>
    </div>
  );
}

function EventShowcase({ brand }: LiveProps) {
  const content = brand?.content;
  const featuredEvent = brand?.events[0] ?? null;
  const lineup = brand
    ? [...brand.events.map((event) => event.title), ...brand.services.map((service) => service.name)].slice(0, 4)
    : ["TSHA", "YAEJI", "9M88", "DJ QUESTIONMARK"];
  return (
    <div className={styles.event} data-live-brand={brand ? "true" : undefined}>
      <LiveReviewBar slug="event" brand={brand} />
      <header className={styles.eventNav}>
        <Link href="#event-top"><BrandWordmark brand={brand}>NOCTURNE<span>TAIPEI</span></BrandWordmark></Link>
        <nav>{brand ? <><a href="#brand-page-content">Events</a><a href={brand.links.records}>My tickets</a><a href={brand.links.line ?? brand.links.primary}>Contact</a></> : <><a href="#lineup">Lineup</a><a href="#agenda">Agenda</a><a href="#venue">Venue</a></>}</nav>
        <a href={featuredEvent ? eventHref(brand, featuredEvent.slug) : brand?.links.primary ?? "#tickets"}>{content?.primary_cta_label ?? "Get tickets"} ↗</a>
      </header>
      <main id="event-top">
        <section className={styles.eventHero}>
          <ShowcaseImage src={content?.hero_image_url ?? "/showcase/event-detail.jpg"} alt={`${brand?.name ?? "NOCTURNE"} 品牌主視覺`} priority sizes="100vw" />
          <div className={styles.eventNoise} />
          <p className={styles.eventDate}>{brand ? <>NOW<br />OPEN<br />2026</> : <>SEP<br />19—20<br />2026</>}</p>
          <h1>{brand?.name ?? "NOCTURNE"}</h1>
          <p className={styles.eventEdition}>{content?.hero_eyebrow ?? <>A TWO-NIGHT CONVERGENCE OF<br />MUSIC, LIGHT & DIGITAL CULTURE</>}</p>
          <div className={styles.eventLocation}><span>{brand?.slug?.toUpperCase() ?? "TAIPEI"}</span><span>{brand?.address ?? "SONGSHAN CULTURAL PARK"}</span></div>
          <a className={styles.eventHeroCta} href={featuredEvent ? eventHref(brand, featuredEvent.slug) : brand?.links.primary ?? "#tickets"}>{content?.primary_cta_label ?? "搶先購票"}　↗</a>
        </section>
        <section className={styles.eventInfo} id={brand ? "brand-page-content" : "tickets"}>
          <div className={styles.eventManifesto}>
            <p>ABOUT / 001</p>
            <h2>{brand ? <><span>{content?.hero_title}</span><i>{content?.hero_highlight}</i></> : <><span>當城市熄燈，</span><span>我們把感官</span><i>全部打開。</i></>}</h2>
            <p>{content?.hero_description ?? "兩個夜晚、三座舞台，以及來自亞洲的聲音與影像創作者。不是另一場音樂祭，而是一個只在夜裡成立的世界。"}</p>
          </div>
          <aside className={styles.eventTicket}>
            <span>{brand ? "REGISTRATION · NOW OPEN" : "EARLY ACCESS · ON SALE"}</span>
            <h3>{featuredEvent?.title ?? "2-Day Pass"}</h3>
            <strong>{brand ? `${brand.events.length} EVENTS` : "NT$ 2,680"}</strong>
            <dl>{brand ? <><div><dt>狀態</dt><dd>開放報名</dd></div><div><dt>入口</dt><dd>線上完成</dd></div><div><dt>紀錄</dt><dd>隨時查詢</dd></div></> : <><div><dt>日期</dt><dd>9/19–9/20</dd></div><div><dt>入場</dt><dd>16:00</dd></div><div><dt>票量</dt><dd>剩餘 18%</dd></div></>}</dl>
            <a href={featuredEvent ? eventHref(brand, featuredEvent.slug) : brand?.links.primary ?? "#"}>{content?.primary_cta_label ?? "選擇票種"} →</a>
            <small>{brand ? "實際場次 · 票種 · 名額 · 付款狀態" : "安全付款 · 電子票券 · 活動前可轉讓一次"}</small>
          </aside>
        </section>
        <section className={styles.eventLineup} id="lineup">
          <span>{brand ? "NOW OPEN" : "FIRST WAVE"}</span>{lineup.map((item) => <strong key={item}>{item}</strong>)}{brand && lineup.length === 0 && <strong>{content?.section_title}</strong>}<a href={brand?.links.registration ?? brand?.links.primary ?? "#agenda"}>{brand ? "ALL EVENTS" : "FULL LINEUP"} ↗</a>
        </section>
      </main>
    </div>
  );
}

function LiveBrandDetails({ brand }: { brand: PublicBrandPageData }) {
  const showEventCards = brand.events.length > 0 && !["education", "event"].includes(brand.template);
  const showServiceCards = brand.services.length > 0 && ["education", "event"].includes(brand.template);
  return (
    <section className={styles.liveBrandDetails} data-template={brand.template} aria-label="品牌完整資訊">
      <div className={styles.liveBrandAbout}>
        <div>
          <p className={styles.liveBrandEyebrow}>關於品牌</p>
          <h2>{brand.content.about_title}</h2>
          <p>{brand.content.about_description}</p>
          <ul>
            {[brand.content.trust_point_1, brand.content.trust_point_2, brand.content.trust_point_3].map((point) => <li key={point}><span>✓</span>{point}</li>)}
          </ul>
        </div>
        <figure>
          <ShowcaseImage src={brand.content.gallery_image_url} alt={`${brand.name} 品牌服務情境`} sizes="(max-width: 768px) 100vw, 44vw" />
        </figure>
      </div>

      {(showEventCards || showServiceCards) && (
        <div className={styles.liveBrandOffers}>
          <header>
            <p className={styles.liveBrandEyebrow}>{showEventCards ? "團體課程與活動" : "也可以預約服務"}</p>
            <h2>{showEventCards ? "選擇場次，查看名額並完成報名。" : "需要個別協助時，也能直接查看可約時段。"}</h2>
          </header>
          <div>
            {showEventCards && brand.events.slice(0, 6).map((event, index) => <a key={event.id} href={eventHref(brand, event.slug)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{event.title}</strong><small>{eventMeta(event)}</small><b>查看場次 →</b></a>)}
            {showServiceCards && brand.services.slice(0, 4).map((service, index) => <a key={service.id} href={brand.links.booking ?? brand.links.primary}><span>{String(index + 1).padStart(2, "0")}</span><strong>{service.name}</strong><small>{service.description ?? "查看服務內容與可預約時段"}</small><b>查看時段 →</b></a>)}
          </div>
        </div>
      )}

      <div className={styles.liveBrandActions}>
        <div><p className={styles.liveBrandEyebrow}>立即開始</p><h2>依照你的目的，直接前往下一步。</h2></div>
        <nav aria-label="品牌服務入口">
          {brand.links.booking && <a href={brand.links.booking}><strong>預約服務</strong><span>私人服務與一對一時段</span></a>}
          {brand.links.registration && <a href={brand.links.registration}><strong>活動／課程報名</strong><span>查看場次、票種與剩餘名額</span></a>}
          {brand.links.membership && <a href={brand.links.membership}><strong>會員與套票</strong><span>查詢方案、堂數與使用紀錄</span></a>}
          {brand.links.learning && <a href={brand.links.learning}><strong>學員專區</strong><span>查看已開放教材與學習進度</span></a>}
          <a href={brand.links.records}><strong>我的紀錄</strong><span>預約、報名、付款與票券</span></a>
        </nav>
      </div>

      <div className={styles.liveBrandFaq}>
        <header><p className={styles.liveBrandEyebrow}>常見問題</p><h2>預約或報名前，先看這裡。</h2></header>
        <div>
          <details open><summary>{brand.content.faq_1_question}<span>＋</span></summary><p>{brand.content.faq_1_answer}</p></details>
          <details><summary>{brand.content.faq_2_question}<span>＋</span></summary><p>{brand.content.faq_2_answer}</p></details>
        </div>
      </div>

      <footer>
        <div><strong>{brand.name}</strong><span>{brand.address ?? "詳細地點請聯絡品牌確認"}</span></div>
        <nav>{brand.phone && <a href={`tel:${brand.phone}`}>電話聯絡</a>}{brand.links.line && <a href={brand.links.line}>加入 LINE</a>}<a href="#">回到頁首 ↑</a></nav>
      </footer>
    </section>
  );
}

export function IndustryShowcase({ slug, brand }: { slug: ShowcaseSlug; brand?: PublicBrandPageData }) {
  const page = (() => {
    switch (slug) {
      case "beauty": return <BeautyShowcase brand={brand} />;
      case "wellness": return <WellnessShowcase brand={brand} />;
      case "fitness": return <FitnessShowcase brand={brand} />;
      case "education": return <EducationShowcase brand={brand} />;
      case "consulting": return <ConsultingShowcase brand={brand} />;
      case "pet-care": return <PetCareShowcase brand={brand} />;
      case "venue": return <VenueShowcase brand={brand} />;
      case "event": return <EventShowcase brand={brand} />;
    }
  })();
  return <>{page}{brand && <LiveBrandDetails brand={brand} />}</>;
}
