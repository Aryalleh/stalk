import type { Child } from "hono/jsx";
import { bankName } from "../../../lib/banks";
import { formatJalali } from "../../../lib/jalali";
import { formatCard } from "../../../lib/normalize";
import {
  deliveryOptions,
  orderStatusLabel,
  toman,
  type DeliveryMethod,
  type ItemView,
  type Order,
  type ProductImage,
  type ProductPackage,
  type ProductWithShop,
  type Shop,
  type Wishlist,
} from "../db";
import { CITIES } from "../cities";
import { DELIVERY_LABEL } from "../notify";
import { readSizeGuide, type SizeGuide } from "../sizes";
import { colorList, variantLabel, variants } from "../variants";
import type { User } from "../../session";
import { useSite } from "../../render";
import { siteDescription } from "../../settings";
import { breadcrumbLd, itemListLd, organizationLd, summary, websiteLd } from "../../schema";
import type { Seo } from "./layout";
import { STEPS, faqs } from "../../content";
import { Avatar, Errors, IconButton, Layout, TitleBar } from "./layout";

// Storefront screens, following html/{home,product,wishlist,checkout,order}.html:
// a Pinterest-like masonry feed of image cards with the title and price over a dark gradient.

const fa = (n: number) => n.toLocaleString("fa-IR");

function ImageOrGift(props: { imageKey: string; alt: string; class?: string }) {
  return props.imageKey ? (
    <img src={`/img/${props.imageKey}`} alt={props.alt} loading="lazy" class={props.class ?? "w-full h-auto block"} />
  ) : (
    <div class="w-full aspect-square flex items-center justify-center text-5xl bg-plum">🎁</div>
  );
}

/** One pin: the photo at its natural height, title and price over a gradient. */
function ProductCard(props: { p: ProductWithShop }) {
  const p = props.p;
  return (
    <a href={`/p/${p.id}`} class="group relative block bg-card rounded-3xl overflow-hidden shadow-lg transition-transform active:scale-95">
      <ImageOrGift imageKey={p.image_key} alt={p.title} class="w-full h-auto block min-h-[140px] object-cover group-hover:scale-105 transition-transform duration-500" />
      <div class="absolute inset-0 photo-scrim"></div>
      <div class="absolute inset-x-0 bottom-0 p-4 on-photo">
        <h3 class="text-xs font-bold text-fg mb-0.5 truncate">{p.title}</h3>
        <div class="text-[11px] text-brand font-bold">{toman(p.price)}</div>
        <div class="text-[10px] text-muted truncate">{p.shop_name}</div>
      </div>
    </a>
  );
}

function Masonry(props: { products: ProductWithShop[]; empty?: string }) {
  if (!props.products.length) {
    return (
      <div class="text-center text-muted py-16">
        <i class="fa-solid fa-box-open text-4xl mb-3 block"></i>
        {props.empty ?? "محصولی پیدا نشد."}
      </div>
    );
  }
  return <div class="masonry">{props.products.map((p) => <ProductCard p={p} />)}</div>;
}

function Pager(props: { page: number; hasNext: boolean; base: string }) {
  if (props.page <= 1 && !props.hasNext) return null;
  const sep = props.base.includes("?") ? "&" : "?";
  const cls = "px-5 py-2.5 rounded-xl bg-card text-sm text-fg";
  return (
    <div class="flex justify-center gap-3 mt-6">
      {props.page > 1 && <a class={cls} href={`${props.base}${sep}page=${props.page - 1}`}>قبلی</a>}
      {props.hasNext && <a class={cls} href={`${props.base}${sep}page=${props.page + 1}`}>بیشتر</a>}
    </div>
  );
}

/** Category pages have clean paths (/c/<name>); searches live under /search?q=…&cat=…. */
export const categoryPath = (cat: string) => `/c/${encodeURIComponent(cat)}`;

function feedUrl(search: boolean, q: string, category: string) {
  if (!search) return category ? categoryPath(category) : "/";
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (category) qs.set("cat", category);
  const s = qs.toString();
  return s ? `/search?${s}` : "/search";
}

/** Home page copy under the feed: how it works, categories and common questions (H2/H3 structure). */
function HomeGuide(props: { categories: string[] }) {
  const site = useSite();
  return (
    <div class="mt-12 space-y-10 text-sm leading-7">
      <section>
        <h2 class="text-lg font-bold mb-4">چطور با {site.site_name} کادو بگیری؟</h2>
        <ol class="grid gap-3 md:grid-cols-4">
          {STEPS.map(([name, text], i) => (
            <li class="bg-card rounded-2xl p-4">
              <h3 class="font-bold mb-1"><span class="text-brand ml-1">{(i + 1).toLocaleString("fa-IR")}.</span>{name}</h3>
              <p class="text-muted text-xs leading-6">{text}</p>
            </li>
          ))}
        </ol>
      </section>
      {props.categories.length > 0 && (
        <section>
          <h2 class="text-lg font-bold mb-4">دسته‌بندی هدیه‌ها</h2>
          <div class="flex flex-wrap gap-2">
            {props.categories.map((c) => (
              <a href={categoryPath(c)} class="px-4 py-2 rounded-xl bg-card text-xs text-fg hover:text-brand">هدیه {c}</a>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 class="text-lg font-bold mb-4">سوالات پرتکرار</h2>
        <div class="space-y-3">
          {faqs(site).slice(0, 4).map(([q, a]) => (
            <div class="bg-card rounded-2xl p-4">
              <h3 class="font-bold mb-1">{q}</h3>
              <p class="text-muted text-xs leading-6">{a}</p>
            </div>
          ))}
        </div>
        <p class="mt-3 text-xs"><a href="/faq" class="text-brand">همه سوالات متداول</a> · <a href="/about" class="text-brand">درباره {site.site_name}</a></p>
      </section>
    </div>
  );
}

export type FeaturedShop = Pick<Shop, "name" | "slug" | "description" | "cover_key" | "logo_key">;

export function HomePage(props: {
  user: User | null;
  q: string;
  category: string;
  categories: string[];
  products: ProductWithShop[];
  page: number;
  hasNext: boolean;
  featured?: FeaturedShop | null;
  search?: boolean;
}) {
  const site = useSite();
  const search = !!props.search;
  const chip = (label: string, cat: string) => (
    <a
      href={feedUrl(search, props.q, cat)}
      class={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium ${props.category === cat ? "bg-brand text-white" : "bg-card text-muted hover:text-fg"}`}
    >
      {label}
    </a>
  );
  const header = (
    <header class="sticky top-0 z-40 bg-ink/90 backdrop-blur-md border-b border-card">
      <div class="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <a href="/" class="text-xl font-bold text-brand">{site.site_name}</a>
          <div class="flex items-center gap-3">
            {props.user ? (
              <>
                <a href="/me/wishlists" aria-label="آرزوهای من" class="hidden md:flex w-10 h-10 items-center justify-center rounded-full bg-card text-muted"><i class="fa-solid fa-gift"></i></a>
                <a href="/panel" aria-label="پنل فروشگاه" class="w-10 h-10 flex items-center justify-center rounded-full bg-card text-muted"><i class="fa-solid fa-store"></i></a>
                <a href="/me" aria-label="پروفایل"><Avatar user={props.user} size="w-10 h-10" /></a>
              </>
            ) : (
              <a href="/login" rel="nofollow" class="px-4 py-2 rounded-xl bg-brand text-white text-sm font-bold">ورود / ثبت‌نام</a>
            )}
          </div>
        </div>
        <form method="get" action="/search" class="relative" role="search">
          <i class="fa-solid fa-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true"></i>
          {props.category && <input type="hidden" name="cat" value={props.category} />}
          <input
            type="search"
            name="q"
            aria-label="جستجوی هدیه"
            value={props.q}
            autofocus={props.search}
            placeholder="جستجوی هدیه، فروشگاه یا برند..."
            class="w-full bg-card border-none rounded-2xl py-3 pr-11 pl-4 text-sm text-fg placeholder:text-muted focus:ring-2 focus:ring-brand outline-hidden"
          />
        </form>
        {props.categories.length > 0 && (
          <div class="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {chip("همه", "")}
            {props.categories.map((c) => chip(c, c))}
          </div>
        )}
      </div>
    </header>
  );
  const f = props.featured;
  // Home and category pages are indexed (one canonical URL each); searches and later pages are not.
  const isHome = !props.search && !props.q && !props.category;
  const title = props.search
    ? props.q ? `جستجوی «${props.q}»` : "جستجوی هدیه"
    : props.category ? `خرید هدیه و کادو ${props.category}؛ ارسال به سراسر ایران` : `${site.site_name} | لیست آرزو، خرید کادو و هدیه آنلاین از فروشگاه‌ها`;
  const seo: Seo = isHome
    ? { index: props.page === 1, canonical: "/", description: siteDescription(site), jsonLd: [organizationLd(site), websiteLd(site), itemListLd(site, "تازه‌ترین هدیه‌ها", props.products)] }
    : props.category && !props.search && !props.q
      ? {
          index: props.page === 1,
          canonical: categoryPath(props.category),
          description: `خرید هدیه و کادو ${props.category} از فروشگاه‌های ${site.site_name}؛ به لیست آرزویت اضافه کن یا مستقیم بخر. پرداخت کارت به کارت مستقیم به فروشگاه.`,
          jsonLd: [
            { "@context": "https://schema.org", "@type": "CollectionPage", name: `هدیه ${props.category}`, url: site.origin + categoryPath(props.category), isPartOf: { "@id": `${site.origin}/#website` } },
            itemListLd(site, `هدیه ${props.category}`, props.products),
            breadcrumbLd(site, [[site.site_name, "/"], [props.category, categoryPath(props.category)]]),
          ],
        }
      : { description: siteDescription(site) };
  return (
    <Layout title={title} fullTitle={isHome} user={props.user} nav={props.search ? "search" : "home"} header={header} bare wide seo={seo}>
      <div class="px-4 py-6">
        {f && !props.q && !props.category && props.page === 1 && (
          <a href={`/s/${f.slug}`} class="block mb-8 overflow-hidden rounded-3xl bg-card relative h-48 group">
            {f.cover_key ? (
              <img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" src={`/img/${f.cover_key}`} alt={f.name} />
            ) : (
              <div class="w-full h-full bg-gradient-to-br from-brand/40 to-plum"></div>
            )}
            <div class="absolute inset-0 photo-scrim"></div>
            <div class="absolute bottom-4 right-5 left-5 on-photo">
              <span class="text-[10px] bg-brand text-white px-2 py-0.5 rounded-full mb-2 inline-block">فروشگاه هفته</span>
              <h2 class="text-xl font-bold text-fg mb-1">{f.name}</h2>
              {f.description && <p class="text-xs text-muted line-clamp-1">{f.description}</p>}
            </div>
          </a>
        )}
        {!props.user && !props.q && !props.category && props.page === 1 && (
          <div class="mb-6 rounded-3xl bg-card p-5">
            <h1 class="text-lg font-bold mb-2">لیست آرزوهایت را بساز، لینکش را بفرست، کادو بگیر 🎁</h1>
            <p class="text-sm text-muted leading-relaxed">
              محصولات دلخواهت را به لیست آرزو اضافه کن و لینکش را برای دوستانت بفرست. هر کس یکی را بخرد، فروشگاه مستقیم برایت
              می‌فرستد — بدون اینکه آدرست را به کسی بدهی.
            </p>
          </div>
        )}
        {isHome && props.user && <h1 class="sr-only">{site.site_name}: لیست آرزو و خرید کادو آنلاین</h1>}
        {props.category && !props.q && <h1 class="text-lg font-bold mb-4">هدیه {props.category}</h1>}
        {(props.q || props.category) && (
          <p class="text-sm text-muted mb-4">
            {props.q && <>نتیجه جستجوی «<b class="text-fg">{props.q}</b>»</>} {props.category && <>در دسته <b class="text-fg">{props.category}</b></>}
          </p>
        )}
        {isHome && props.products.length > 0 && <h2 class="text-lg font-bold mb-4">تازه‌ترین هدیه‌ها</h2>}
        <Masonry products={props.products} empty={props.search && !props.q && !props.category ? "دنبال چه هدیه‌ای می‌گردی؟" : undefined} />
        <Pager page={props.page} hasNext={props.hasNext} base={feedUrl(search, props.q, props.category)} />
        {isHome && props.page === 1 && <HomeGuide categories={props.categories} />}
      </div>
    </Layout>
  );
}

/** Turn a pasted Instagram / Telegram / Bale link into a label for the video button. */
function videoLink(url: string): [string, string] {
  if (/instagram\.com/i.test(url)) return ["fa-brands fa-instagram", "ویدیو در اینستاگرام"];
  if (/(t\.me|telegram\.me)/i.test(url)) return ["fa-brands fa-telegram", "ویدیو در تلگرام"];
  if (/ble\.ir/i.test(url)) return ["fa-solid fa-circle-play", "ویدیو در بله"];
  return ["fa-solid fa-circle-play", "مشاهده ویدیو"];
}

/** Swipeable photos (scroll-snap) with dots that follow the scroll. */
function Gallery(props: { images: ProductImage[]; title: string; overlay: Child }) {
  const imgs = props.images;
  const script = `(function(){var g=document.getElementById('gallery-track');if(!g)return;var d=document.querySelectorAll('#gallery-dots span');
    g.addEventListener('scroll',function(){var i=Math.round(Math.abs(g.scrollLeft)/g.clientWidth);d.forEach(function(x,k){x.className=k===i?'w-2 h-2 rounded-full bg-brand':'w-2 h-2 rounded-full bg-fg/30';});},{passive:true});})();`;
  return (
    <section class="relative w-full aspect-[4/5] md:aspect-[16/10] max-h-[80vh] bg-card overflow-hidden">
      {imgs.length ? (
        <div id="gallery-track" class="flex h-full overflow-x-auto snap-x snap-mandatory no-scrollbar">
          {imgs.map((img, i) => (
            <img src={`/img/${img.image_key}`} alt={props.title} loading={i ? "lazy" : "eager"} class="w-full h-full object-cover shrink-0 snap-center" />
          ))}
        </div>
      ) : (
        <div class="w-full h-full flex items-center justify-center text-7xl">🎁</div>
      )}
      <div class="absolute inset-0 photo-scrim pointer-events-none"></div>
      <div class="absolute bottom-10 inset-x-6 pointer-events-none on-photo">{props.overlay}</div>
      {imgs.length > 1 && (
        <div id="gallery-dots" class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
          {imgs.map((_, i) => <span class={`w-2 h-2 rounded-full ${i ? "bg-fg/30" : "bg-brand"}`}></span>)}
        </div>
      )}
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </section>
  );
}

function SizeGuideBox(props: { guide: SizeGuide | null; image: string }) {
  if (!props.guide && !props.image) return null;
  return (
    <details class="bg-card rounded-2xl p-4" open>
      <summary class="cursor-pointer text-sm font-bold"><i class="fa-solid fa-ruler text-brand ml-2"></i>راهنمای سایز</summary>
      {props.guide && (
        <div class="overflow-x-auto mt-3">
          <table class="w-full text-xs text-center">
            <thead>
              <tr class="text-muted">{props.guide.columns.map((c) => <th class="p-2 font-medium whitespace-nowrap">{c}</th>)}</tr>
            </thead>
            <tbody>
              {props.guide.rows.map((r) => (
                <tr class="border-t border-ink">{r.map((v, i) => (i === 0 ? <td class="p-2 font-bold text-fg">{v}</td> : <td class="p-2 text-muted">{v || "—"}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.image && <img src={`/img/${props.image}`} alt="جدول سایز" loading="lazy" class="max-w-full rounded-xl mt-3" />}
    </details>
  );
}

const field = "w-full bg-ink border border-plum rounded-xl px-3 py-2.5 text-sm text-fg outline-hidden focus:border-brand";

export function ProductPage(props: {
  user: User | null;
  product: ProductWithShop;
  shop: { logo_key: string; sales: number };
  wishlists: Wishlist[];
  images: ProductImage[];
  packages: ProductPackage[];
  /** Units free to sell per variant ("size|color"); null = stock not tracked. */
  available?: Record<string, number> | null;
  added?: string;
  error?: string;
}) {
  const p = props.product;
  const guide = readSizeGuide(p.size_guide);
  const opts = variants(p).filter((x) => x.label); // the size/color combinations to choose from
  const colors = colorList(p.colors);
  const avail = props.available ?? null;
  const totalLeft = avail ? Object.values(avail).reduce((a, b) => a + b, 0) : Infinity;
  const soldOut = totalLeft <= 0;
  const features = p.features.split("\n").map((s) => s.trim()).filter(Boolean);
  const loginHref = `/login?next=/p/${p.id}`;
  const nofollow = props.user ? undefined : "nofollow";
  const wishHref = !props.user ? loginHref : props.wishlists.length ? "#wish" : `/me/wishlists/new?product=${p.id}`;
  const sheetOpen = !!props.error;
  const site = useSite();
  const images = props.images.length ? props.images.map((i) => i.image_key) : p.image_key ? [p.image_key] : [];
  const url = `${site.origin}/p/${p.id}`;
  const seo: Seo = {
    index: true,
    canonical: `/p/${p.id}`,
    type: "product",
    description: summary(p.description ? `${p.title}: ${p.description}` : `خرید ${p.title} از فروشگاه ${p.shop_name} در ${site.site_name}؛ به لیست آرزویت اضافه کن تا دوستانت برایت کادو بخرند، یا مستقیم بخر.`),
    image: images[0] ? `/img/${images[0]}` : undefined,
    props: [["product:price:amount", String(p.price * 10)], ["product:price:currency", "IRR"]],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": `${url}#product`,
        name: p.title,
        description: p.description || p.title,
        sku: String(p.id),
        url,
        ...(images.length ? { image: images.map((k) => `${site.origin}/img/${k}`) } : {}),
        ...(p.category ? { category: p.category } : {}),
        brand: { "@type": "Brand", name: p.shop_name },
        ...(features.length ? { additionalProperty: features.map((x) => ({ "@type": "PropertyValue", name: "ویژگی", value: x })) } : {}),
        offers: {
          "@type": "Offer",
          url,
          price: String(p.price * 10),
          priceCurrency: "IRR",
          availability: soldOut ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
          areaServed: { "@type": "Country", name: "Iran" },
          seller: { "@type": "Organization", name: p.shop_name, url: `${site.origin}/s/${p.shop_slug}` },
        },
      },
      breadcrumbLd(site, [
        [site.site_name, "/"],
        ...(p.category ? ([[p.category, categoryPath(p.category)]] as [string, string][]) : []),
        [p.shop_name, `/s/${p.shop_slug}`],
        [p.title, `/p/${p.id}`],
      ]),
    ],
  };
  const header = (
    <header class="fixed top-0 inset-x-0 z-50 px-4 py-4 flex items-center justify-between pointer-events-none">
      <div class="pointer-events-auto"><IconButton icon="fa-chevron-right" label="بازگشت" glass attrs={{ "data-back": "/" }} /></div>
      <div class="flex gap-2 pointer-events-auto">
        <IconButton icon="fa-heart" label="افزودن به آرزوها" glass href={wishHref} attrs={nofollow ? { rel: nofollow } : undefined} />
        <IconButton icon="fa-share-nodes" label="اشتراک" glass attrs={{ "data-share": "" }} />
      </div>
    </header>
  );
  const overlay = (
    <>
      <div class="flex items-center gap-2 mb-2">
        {p.category && <span class="text-[10px] font-bold text-brand bg-brand/10 backdrop-blur-md px-2 py-1 rounded-lg">{p.category}</span>}
        <span class="text-[10px] text-fg/60">• {p.shop_name}</span>
      </div>
      <h1 class="text-2xl font-black text-fg mb-2 leading-tight">{p.title}</h1>
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="text-2xl font-black text-brand">{fa(p.price)}</span>
        <span class="text-xs text-fg/60">تومان</span>
        {soldOut ? (
          <span class="text-[11px] font-bold text-white bg-red-500/80 px-2 py-0.5 rounded-lg mr-2">ناموجود</span>
        ) : totalLeft <= 3 ? (
          <span class="text-[11px] font-bold text-amber-200 bg-amber-500/20 px-2 py-0.5 rounded-lg mr-2">فقط {fa(totalLeft)} عدد باقی مانده</span>
        ) : null}
      </div>
    </>
  );
  return (
    <Layout title={`${p.title} | ${p.shop_name}`} user={props.user} nav="none" header={header} bare seo={seo}>
      <Gallery images={props.images} title={p.title} overlay={overlay} />
      <div class="px-6 py-8 pb-36 space-y-6">
        {props.added && (
          <div class="rounded-2xl bg-ok/15 text-green-300 px-4 py-3 text-sm">
            <i class="fa-solid fa-circle-check ml-1"></i> به لیست «{props.added}» اضافه شد. <a class="underline" href="/me/wishlists">مشاهده لیست‌ها</a>
          </div>
        )}
        {p.description && (
          <div>
            <h2 class="text-sm font-bold text-fg mb-2">توضیحات محصول</h2>
            <p class="text-sm text-muted leading-relaxed whitespace-pre-wrap">{p.description}</p>
          </div>
        )}
        {features.length > 0 && (
          <div>
            <h2 class="text-sm font-bold text-fg mb-3">ویژگی‌های کلیدی</h2>
            <ul class="grid grid-cols-2 gap-3">
              {features.map((x) => (
                <li class="flex items-center gap-2 text-xs text-muted"><i class="fa-solid fa-circle-check text-brand"></i><span>{x}</span></li>
              ))}
            </ul>
          </div>
        )}
        {p.video_url && (() => {
          const [icon, label] = videoLink(p.video_url);
          return (
            <a href={p.video_url} target="_blank" rel="noopener nofollow" class="flex items-center gap-3 p-4 bg-card rounded-2xl text-sm font-bold">
              <i class={`${icon} text-brand text-xl`}></i> {label} <i class="fa-solid fa-arrow-up-left-from-square text-muted text-xs mr-auto"></i>
            </a>
          );
        })()}
        {colors.length > 0 && (
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-muted">رنگ‌ها:</span>
            {colors.map((c) => <span class="px-2.5 py-1 rounded-lg bg-card text-fg">{c}</span>)}
          </div>
        )}
        {avail && opts.length > 0 && (
          <div class="flex flex-wrap gap-2 text-xs">
            <span class="text-muted">موجود:</span>
            {opts.map((o) => (
              <span class={`px-2 py-0.5 rounded-lg bg-card ${avail[o.key] ? "text-fg" : "text-muted line-through"}`}>{o.label.replace(/^سایز |رنگ /g, "")}</span>
            ))}
          </div>
        )}
        <SizeGuideBox guide={guide} image={p.size_guide_image} />
        {props.packages.length > 0 && (
          <div class="bg-card rounded-2xl p-4">
            <h2 class="text-sm font-bold mb-3"><i class="fa-solid fa-gift text-brand ml-2"></i>بسته‌بندی‌های کادویی</h2>
            {props.packages.map((k) => (
              <div class="flex justify-between text-xs text-muted py-1.5"><span>{k.name}</span><span>{k.price ? toman(k.price) : "رایگان"}</span></div>
            ))}
            <p class="text-[10px] text-muted/70 mt-2">خریدار کادو هنگام خرید بسته‌بندی را انتخاب می‌کند.</p>
          </div>
        )}
        <div class="p-4 bg-card rounded-2xl flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-ink flex items-center justify-center overflow-hidden text-brand font-bold">
              {props.shop.logo_key ? <img class="w-full h-full object-cover" src={`/img/${props.shop.logo_key}`} alt={p.shop_name} /> : p.shop_name.charAt(0)}
            </div>
            <div>
              <h3 class="text-sm font-bold text-fg">{p.shop_name}</h3>
              <p class="text-[10px] text-muted">{props.shop.sales ? `${fa(props.shop.sales)} فروش موفق` : "فروشگاه تازه"}</p>
            </div>
          </div>
          <a href={`/s/${p.shop_slug}`} class="px-4 py-2 bg-ink text-xs font-bold text-fg rounded-xl">مشاهده</a>
        </div>
      </div>

      {/* Add-to-wishlist sheet, opened by #wish (no JS needed). */}
      {props.user && props.wishlists.length > 0 && (
        <div id="wish" class={`${sheetOpen ? "flex" : "hidden"} target:flex fixed inset-0 z-[60] bg-black/60 items-end md:items-center justify-center`}>
          <a href="#" class="absolute inset-0" aria-label="بستن"></a>
          <form method="post" action={`/p/${p.id}/wish`} class="relative w-full max-w-md bg-card rounded-t-3xl md:rounded-3xl p-6 space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="font-bold">افزودن به لیست آرزو</h2>
              <a href="#" class="text-muted" aria-label="بستن"><i class="fa-solid fa-xmark"></i></a>
            </div>
            <Errors errors={[props.error]} />
            <label class="block text-xs text-muted">لیست</label>
            <select name="wishlist_id" class={field}>
              {props.wishlists.map((w) => <option value={String(w.id)}>{w.title}</option>)}
            </select>
            {opts.length > 0 && (
              <>
                <label class="block text-xs text-muted">سایز / رنگ</label>
                <select name="variant" required class={field}>
                  <option value="">انتخاب کنید…</option>
                  {opts.map((o) => <option value={o.key}>{o.label}{avail && !avail[o.key] ? " (فعلاً ناموجود)" : ""}</option>)}
                </select>
              </>
            )}
            <div class="flex gap-3">
              <div class="w-24">
                <label class="block text-xs text-muted mb-1">تعداد</label>
                <input name="quantity" type="number" min="1" max="20" value="1" class={field} />
              </div>
              <div class="flex-1">
                <label class="block text-xs text-muted mb-1">یادداشت (اختیاری)</label>
                <input name="note" maxlength={200} class={field} />
              </div>
            </div>
            <button class="w-full py-3.5 bg-brand text-white rounded-2xl font-bold">❤ افزودن به آرزوها</button>
            <a href={`/me/wishlists/new?product=${p.id}`} class="block text-center text-xs text-muted">یا ساخت لیست جدید</a>
          </form>
        </div>
      )}

      <div class="fixed bottom-0 inset-x-0 z-50 bg-ink/95 backdrop-blur-lg border-t border-card">
        <div class="max-w-3xl mx-auto p-4 safe-bottom flex gap-3">
          <a href={wishHref} rel={nofollow} class="flex-[2] py-4 bg-brand text-white text-center rounded-2xl font-bold shadow-lg shadow-brand/20 active:scale-95 transition-transform">
            {!props.user ? "ورود و افزودن به لیست آرزو" : props.wishlists.length ? "افزودن به لیست آرزوها" : "ساخت لیست آرزو و افزودن این محصول"}
          </a>
          <a href={soldOut ? "#" : props.user ? `/p/${p.id}/buy` : `/login?next=/p/${p.id}/buy`} rel={nofollow} aria-disabled={soldOut ? "true" : undefined} class={`${soldOut ? "opacity-40 pointer-events-none " : ""}flex-1 py-4 bg-card text-fg text-center rounded-2xl font-bold border border-muted/20 active:scale-95 transition-transform`}>
            <i class="fa-solid fa-bag-shopping ml-1"></i> {soldOut ? "ناموجود" : "خرید مستقیم"}
          </a>
        </div>
      </div>
    </Layout>
  );
}

const SOCIALS: [keyof Shop, string, string, (v: string) => string][] = [
  ["instagram", "اینستاگرام", "fa-brands fa-instagram", (v) => (v.startsWith("http") ? v : `https://instagram.com/${v.replace(/^@/, "")}`)],
  ["telegram", "تلگرام", "fa-brands fa-telegram", (v) => (v.startsWith("http") ? v : `https://t.me/${v.replace(/^@/, "")}`)],
  ["bale", "بله", "fa-solid fa-comment-dots", (v) => (v.startsWith("http") ? v : `https://ble.ir/${v.replace(/^@/, "")}`)],
  ["website", "وب‌سایت", "fa-solid fa-globe", (v) => (v.startsWith("http") ? v : `https://${v}`)],
];

export function ShopPage(props: { user: User | null; shop: Shop; products: ProductWithShop[]; preview?: boolean }) {
  const shop = props.shop;
  const site = useSite();
  const url = `${site.origin}/s/${shop.slug}`;
  const sameAs = SOCIALS.filter(([k]) => shop[k]).map(([k, , , link]) => link(String(shop[k])));
  const seo: Seo = {
    index: !props.preview,
    canonical: `/s/${shop.slug}`,
    type: "profile",
    place: shop.city || undefined,
    description: summary(shop.description ? `${shop.name}${shop.city ? ` (${shop.city})` : ""}: ${shop.description}` : `فروشگاه ${shop.name}${shop.city ? ` در ${shop.city}` : ""}؛ خرید هدیه و کادو در ${site.site_name}.`),
    image: shop.cover_key ? `/img/${shop.cover_key}` : shop.logo_key ? `/img/${shop.logo_key}` : undefined,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Store",
        "@id": `${url}#store`,
        name: shop.name,
        url,
        ...(shop.description ? { description: shop.description } : {}),
        ...(shop.logo_key ? { logo: `${site.origin}/img/${shop.logo_key}` } : {}),
        ...(shop.cover_key || shop.logo_key ? { image: `${site.origin}/img/${shop.cover_key || shop.logo_key}` } : {}),
        ...(shop.phone ? { telephone: shop.phone } : {}),
        address: { "@type": "PostalAddress", addressCountry: "IR", ...(shop.city ? { addressLocality: shop.city } : {}) },
        ...(sameAs.length ? { sameAs } : {}),
        paymentAccepted: "کارت به کارت",
        currenciesAccepted: "IRR",
      },
      itemListLd(site, `محصولات ${shop.name}`, props.products),
      breadcrumbLd(site, [[site.site_name, "/"], [shop.name, `/s/${shop.slug}`]]),
    ],
  };
  return (
    <Layout title={shop.city ? `${shop.name} | ${shop.city}` : shop.name} user={props.user} bare wide seo={seo}>
      {props.preview && (
        <div class="bg-amber-400/10 text-amber-200 text-sm px-4 py-3 text-center">
          پیش‌نمایش: این فروشگاه هنوز تأیید نشده و فقط شما (و مدیر سایت) این صفحه را می‌بینید.
        </div>
      )}
      <section class="relative">
        <div class="h-40 md:h-56 bg-card overflow-hidden relative">
          {shop.cover_key ? <img src={`/img/${shop.cover_key}`} alt="" class="w-full h-full object-cover" /> : <div class="w-full h-full bg-gradient-to-br from-brand/30 to-plum"></div>}
          <div class="absolute inset-0 photo-scrim"></div>
        </div>
        <div class="px-6 -mt-10 relative flex items-end gap-4">
          <div class="w-20 h-20 rounded-2xl bg-card border-4 border-ink overflow-hidden flex items-center justify-center text-3xl font-bold text-brand shrink-0">
            {shop.logo_key ? <img src={`/img/${shop.logo_key}`} alt={shop.name} class="w-full h-full object-cover" /> : shop.name.charAt(0)}
          </div>
          <div class="min-w-0 bg-card/95 backdrop-blur-md rounded-2xl px-4 py-2 shadow-lg border border-fg/5">
            <h1 class="text-xl font-bold truncate">{shop.name}</h1>
            {shop.city && <p class="text-xs text-muted"><i class="fa-solid fa-location-dot ml-1"></i>{shop.city}</p>}
          </div>
        </div>
      </section>
      <div class="px-6 pt-4 pb-2 space-y-4">
        {shop.description && <p class="text-sm text-muted leading-relaxed whitespace-pre-wrap">{shop.description}</p>}
        <div class="flex flex-wrap gap-2">
          {SOCIALS.filter(([k]) => shop[k]).map(([k, label, icon, url]) => (
            <a class="px-3 py-2 rounded-xl bg-card text-xs text-fg flex items-center gap-2" href={url(String(shop[k]))} target="_blank" rel="noopener nofollow">
              <i class={`${icon} text-brand`}></i>{label}
            </a>
          ))}
        </div>
      </div>
      <div class="px-4 py-4">
        <Masonry products={props.products} empty="این فروشگاه هنوز محصولی ندارد." />
      </div>
    </Layout>
  );
}

export function WishlistPublicPage(props: {
  user: User | null;
  wishlist: Wishlist;
  owner: { name: string; avatar_key: string; username: string };
  items: ItemView[];
  isOwner: boolean;
  shareUrl: string;
}) {
  const site = useSite();
  const w = props.wishlist;
  const header = (
    <header class="sticky top-0 z-40 bg-ink/80 backdrop-blur-md border-b border-card">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <IconButton icon="fa-chevron-right" label="بازگشت" attrs={{ "data-back": "/" }} />
        <a href="/" class="text-lg font-medium text-brand">{site.site_name}</a>
        <IconButton icon="fa-share-nodes" label="اشتراک" attrs={{ "data-share": props.shareUrl }} />
      </div>
    </header>
  );
  const done = props.items.filter((it) => it.bought >= it.quantity).length;
  const cover = props.items.find((it) => it.image_key)?.image_key;
  const seo: Seo = {
    description: summary(w.description || `لیست آرزوی ${props.owner.name} در ${site.site_name}: ${props.items.length} آرزو. یکی را انتخاب کن و برایش کادو بخر.`),
    image: cover ? `/img/${cover}` : props.owner.avatar_key ? `/img/${props.owner.avatar_key}` : undefined,
  };
  return (
    <Layout title={`${w.title} | آرزوهای ${props.owner.name}`} user={props.user} nav={props.isOwner ? "wishes" : "home"} header={header} bare wide seo={seo}>
      <section class="px-6 py-8 text-center bg-gradient-to-b from-card to-ink rounded-b-[32px] mb-6">
        <a href={props.owner.username ? `/u/${props.owner.username}` : "#"} class="relative inline-block mb-4" aria-label={`پروفایل ${props.owner.name}`}>
          <Avatar user={props.owner} size="w-24 h-24" ring />
          <div class="absolute -bottom-1 -left-1 bg-brand text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] border-2 border-ink">
            <i class="fa-solid fa-gift"></i>
          </div>
        </a>
        <h1 class="text-2xl font-bold mb-1">{w.title}</h1>
        <p class="text-sm text-muted">
          آرزوهای <b class="text-fg">{props.owner.name}</b>
          {w.occasion_date && <> · {w.occasion_date}</>}
        </p>
        {w.description && <p class="text-sm text-muted max-w-sm mx-auto leading-relaxed mt-2 whitespace-pre-wrap">{w.description}</p>}
        {props.items.length > 0 && <p class="text-xs text-muted mt-3">{fa(done)} از {fa(props.items.length)} آرزو برآورده شده</p>}
        {props.isOwner && (
          <div class="mt-5 max-w-md mx-auto bg-ink/60 rounded-2xl p-3 text-right">
            <p class="text-xs text-muted mb-2">این لیست خودتان است؛ این لینک را بفرستید:</p>
            <div class="flex gap-2">
              <input readonly value={props.shareUrl} class="flex-1 min-w-0 bg-card rounded-xl px-3 py-2 text-xs ltr text-fg" onclick="this.select()" />
              <button type="button" data-copy={props.shareUrl} data-copied="کپی شد ✓" class="px-3 py-2 bg-brand text-white rounded-xl text-xs font-bold">کپی</button>
              <a href={`/me/wishlists/${w.id}`} class="px-3 py-2 bg-card text-fg rounded-xl text-xs">ویرایش</a>
            </div>
          </div>
        )}
        {!w.is_open && <p class="mt-4 text-sm text-amber-200">این لیست بسته شده و فعلاً امکان خرید ندارد.</p>}
      </section>
      <section class="px-4">
        {props.items.length === 0 && <p class="text-center text-muted py-10">هنوز آرزویی اضافه نشده.</p>}
        <div class="masonry">
          {props.items.map((it) => {
            const fulfilled = it.bought >= it.quantity;
            const free = it.quantity - it.bought - it.reserved;
            const ships = deliveryOptions(
              { city: it.shop_city, courier_enabled: it.courier_enabled, courier_fee: it.courier_fee, post_enabled: it.post_enabled, post_fee: it.post_fee },
              w.city,
            ).length > 0;
            const buyable = w.is_open && it.product_active && it.shop_ok && ships && free > 0 && it.in_stock;
            const status = fulfilled
              ? "تمام شد"
              : !it.in_stock && it.product_active
                ? "فعلاً ناموجود"
                : props.isOwner
                ? null
                : it.reserved > 0 && free <= 0
                  ? "در حال خرید توسط شخص دیگر"
                  : !ships && it.shop_ok
                    ? "فروشگاه به شهر گیرنده ارسال ندارد"
                    : "فعلاً موجود نیست";
            return (
              <div class="item-card group relative bg-card rounded-3xl overflow-hidden shadow-lg">
                <a href={`/p/${it.product_id}`}>
                  <ImageOrGift imageKey={it.image_key} alt={it.title} class={`w-full h-auto block min-h-[160px] object-cover ${fulfilled ? "opacity-60" : ""}`} />
                </a>
                <div class="absolute inset-0 photo-scrim pointer-events-none"></div>
                {fulfilled ? (
                  <div class="absolute top-3 right-3 bg-ok px-2 py-1 rounded-lg text-[10px] text-white">✓ برآورده شد</div>
                ) : it.quantity > 1 && it.bought > 0 ? (
                  <div class="absolute top-3 right-3 bg-ink/60 backdrop-blur-md px-2 py-1 rounded-lg text-[10px] text-brand border border-brand/20">
                    {fa(it.bought)} از {fa(it.quantity)} خریده شده
                  </div>
                ) : it.quantity > 1 ? (
                  <div class="absolute top-3 right-3 bg-ink/60 backdrop-blur-md px-2 py-1 rounded-lg text-[10px] text-fg">{fa(it.quantity)} عدد</div>
                ) : null}
                <div class="absolute inset-x-0 bottom-0 p-4 on-photo">
                  <h3 class="text-xs font-bold text-fg mb-0.5 truncate">{it.title}</h3>
                  <div class={`text-[11px] font-bold ${fulfilled ? "text-muted" : "text-brand"}`}>{toman(it.price)}</div>
                  {variantLabel(it.size, it.color) && <div class="text-[10px] text-fg/80">{variantLabel(it.size, it.color)}</div>}
                  {it.note && <div class="text-[10px] text-muted truncate">{it.note}</div>}
                  {buyable && !fulfilled && !props.isOwner ? (
                    <a href={`/gift/${it.id}`} class="mt-3 block w-full py-2 bg-brand text-white text-center rounded-xl text-[11px] font-bold shadow-lg shadow-brand/20">
                      🎁 کادو بده
                    </a>
                  ) : status ? (
                    <span class="mt-3 block w-full py-2 bg-plum text-muted text-center rounded-xl text-[10px] font-bold">{status}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}

function Row(props: { label: Child; value: Child; strong?: boolean }) {
  return (
    <div class={`flex justify-between ${props.strong ? "text-sm font-bold text-brand pt-2" : "text-xs text-muted"}`}>
      <span>{props.label}</span>
      <span>{props.value}</span>
    </div>
  );
}

function Option(props: { name: string; value: string; price: number; checked: boolean; title: Child; hint?: Child }) {
  return (
    <label class="flex items-center gap-3 p-4 bg-card rounded-2xl border border-muted/10 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand/5">
      <input type="radio" name={props.name} value={props.value} data-price={String(props.price)} checked={props.checked} class="accent-brand w-4 h-4" />
      <span class="flex-1 text-sm text-fg">
        {props.title}
        {props.hint && <span class="block text-[10px] text-muted">{props.hint}</span>}
      </span>
      <span class="text-xs font-bold text-brand">{props.price ? toman(props.price) : "رایگان"}</span>
    </label>
  );
}

export function CheckoutPage(props: {
  user: User | null;
  item: ItemView;
  wishlist: Wishlist;
  ownerName: string;
  packages: ProductPackage[];
  delivery: { method: DeliveryMethod; fee: number }[];
  values?: Record<string, string>;
  errors?: string[];
}) {
  const v = props.values ?? {};
  const it = props.item;
  const pkgDefault = v.package ?? (props.packages[0] ? String(props.packages[0].id) : "");
  const shipDefault = v.delivery ?? props.delivery[0]?.method ?? "";
  // Live total as the giver picks options (the server recomputes the real amount).
  const script = `(function(){var f=document.getElementById('checkout');if(!f)return;
    function fa(n){return n.toLocaleString('fa-IR')+' تومان';}
    function upd(){var t=${it.price},p=f.querySelector('input[name=package]:checked'),d=f.querySelector('input[name=delivery]:checked');
      var pp=p?Number(p.dataset.price):0,dd=d?Number(d.dataset.price):0;t+=pp+dd;
      document.getElementById('total').textContent=fa(t);
      var a=document.getElementById('pkg-fee');if(a)a.textContent=pp?fa(pp):'رایگان';
      var b=document.getElementById('ship-fee');if(b)b.textContent=dd?fa(dd):'رایگان';}
    f.addEventListener('change',upd);upd();
    var sp=document.getElementById('show-on-profile');
    function vis(){var a=f.querySelector('input[name=visibility][value=anonymous]');if(!sp||!a)return;var cb=sp.querySelector('input');cb.disabled=a.checked;if(a.checked)cb.checked=false;sp.style.opacity=a.checked?'.4':'1';}
    f.addEventListener('change',vis);vis();})();`;
  const input = "w-full bg-card border border-muted/10 rounded-xl px-4 py-3 text-sm text-fg outline-hidden focus:border-brand";
  const direct = !!props.wishlist.is_direct;
  const heading = direct ? "خرید برای خودم" : "خرید کادو";
  return (
    <Layout title={heading} user={props.user} nav="none" header={<TitleBar title={heading} back={direct ? `/p/${it.product_id}` : `/w/${props.wishlist.slug}`} />} bare>
      <form method="post" action={`/gift/${it.id}`} id="checkout" class="px-6 pb-36 space-y-8">
        <section class="p-4 bg-card rounded-2xl border border-muted/10">
          <div class="flex items-center gap-4 mb-4">
            <div class="w-16 h-16 rounded-xl overflow-hidden bg-ink shrink-0">
              <ImageOrGift imageKey={it.image_key} alt={it.title} class="w-full h-full object-cover" />
            </div>
            <div class="min-w-0">
              <h2 class="text-sm font-bold text-fg truncate">{it.title}</h2>
              <p class="text-[10px] text-muted">{direct ? `ارسال به ${props.wishlist.city}` : `برای: لیست «${props.wishlist.title}» ${props.ownerName}`}</p>
              <p class="text-[10px] text-muted">{it.shop_name}{variantLabel(it.size, it.color) && <> · <b class="text-fg">{variantLabel(it.size, it.color)}</b></>}</p>
            </div>
          </div>
          <div class="space-y-3 pt-4 border-t border-ink">
            <Row label="قیمت کالا" value={toman(it.price)} />
            {props.packages.length > 0 && <Row label="بسته‌بندی" value={<span id="pkg-fee">—</span>} />}
            <Row label="ارسال" value={<span id="ship-fee">—</span>} />
            <Row strong label="مبلغ قابل پرداخت" value={<span id="total">{toman(it.price)}</span>} />
          </div>
        </section>

        <Errors errors={props.errors} />
        {!it.in_stock && (
          <div class="rounded-2xl bg-red-500/10 text-red-300 px-4 py-3 text-sm">
            این کالا{variantLabel(it.size, it.color) ? ` (${variantLabel(it.size, it.color)})` : ""} فعلاً در فروشگاه ناموجود است.
          </div>
        )}

        {props.packages.length > 0 && (
          <section class="space-y-3">
            <h3 class="text-sm font-bold px-1">بسته‌بندی کادو</h3>
            {props.packages.map((k) => <Option name="package" value={String(k.id)} price={k.price} checked={pkgDefault === String(k.id)} title={k.name} />)}
          </section>
        )}

        <section class="space-y-3">
          <h3 class="text-sm font-bold px-1">روش ارسال</h3>
          {props.delivery.length === 0 ? (
            <div class="rounded-2xl bg-red-500/10 text-red-300 px-4 py-3 text-sm">این فروشگاه به شهر گیرنده ارسال ندارد.</div>
          ) : (
            props.delivery.map((d) => (
              <Option
                name="delivery"
                value={d.method}
                price={d.fee}
                checked={shipDefault === d.method}
                title={<><i class={`fa-solid ${d.method === "courier" ? "fa-motorcycle" : "fa-box"} text-brand ml-2`}></i>{DELIVERY_LABEL[d.method]}</>}
                hint={`به ${props.wishlist.city || "شهر گیرنده"}`}
              />
            ))
          )}
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-bold px-1">مشخصات شما</h3>
          <input name="name" value={v.name ?? props.user?.name ?? ""} required maxlength={80} placeholder="نام شما" class={input} />
          <input name="phone" value={v.phone ?? props.user?.phone ?? ""} inputmode="tel" required placeholder="شماره موبایل" class={`${input} ltr text-left`} />
          {!direct && (
            <>
              <textarea name="message" maxlength={300} rows={3} placeholder="پیام روی کارت هدیه (اختیاری)" class={input}>{v.message ?? ""}</textarea>
              <fieldset class="space-y-2 pt-1" id="visibility">
                <legend class="text-xs text-muted px-1 mb-1">گیرنده شما را بشناسد؟</legend>
                <label class="flex items-center gap-2 text-sm text-fg px-1">
                  <input type="radio" name="visibility" value="named" checked={v.visibility !== "anonymous" && v.anonymous !== "1"} class="accent-brand" /> با نام من
                </label>
                <label class="flex items-center gap-2 text-sm text-fg px-1">
                  <input type="radio" name="visibility" value="anonymous" checked={v.visibility === "anonymous" || v.anonymous === "1"} class="accent-brand" /> ناشناس (نامم به گیرنده نشان داده نشود)
                </label>
                <label class="flex items-start gap-2 text-xs text-muted px-1 pt-1" id="show-on-profile">
                  <input type="checkbox" name="show_on_profile" value="1" checked={v.show_on_profile === "1"} class="accent-brand mt-0.5" />
                  <span>نامم زیر این کادو در پروفایل عمومی {props.ownerName} هم نمایش داده شود (همه می‌بینند)</span>
                </label>
              </fieldset>
            </>
          )}
        </section>

        <p class="text-[11px] text-muted leading-relaxed px-1">
          <i class="fa-solid fa-lock ml-1"></i>
          پرداخت کارت به کارت مستقیم به حساب فروشگاه است: در مرحله بعد شماره کارت را می‌بینید و فقط عکس فیش را می‌فرستید.
          {direct ? " آدرس شما فقط بعد از تأیید واریز به فروشگاه نشان داده می‌شود." : " آدرس گیرنده محرمانه است و به شما نمایش داده نمی‌شود."}
        </p>
      </form>
      <div class="fixed bottom-0 inset-x-0 z-50 bg-ink/95 backdrop-blur-lg border-t border-card">
        <div class="max-w-3xl mx-auto p-4 safe-bottom">
          <button form="checkout" disabled={props.delivery.length === 0 || !it.in_stock} class="w-full py-4 bg-brand text-white rounded-2xl font-bold shadow-lg shadow-brand/20 flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40">
            ادامه و دریافت شماره کارت <i class="fa-solid fa-arrow-left"></i>
          </button>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}

export type OrderView = Order & {
  wishlist_slug: string;
  owner_name: string;
  card_holder: string;
  shop_name: string;
  image_key: string;
  is_direct: number;
};

const RECEIPT_PREVIEW = `(function(){var i=document.getElementById('receipt-input'),z=document.getElementById('dropzone'),p=document.getElementById('receipt-preview');if(!i)return;
  function show(){var f=i.files&&i.files[0];if(!f){p.classList.add('hidden');return;}p.src=URL.createObjectURL(f);p.classList.remove('hidden');document.getElementById('dz-text').textContent=f.name;}
  i.addEventListener('change',show);
  ['dragover','dragenter'].forEach(function(e){z.addEventListener(e,function(ev){ev.preventDefault();z.classList.add('border-brand');});});
  ['dragleave','drop'].forEach(function(e){z.addEventListener(e,function(){z.classList.remove('border-brand');});});
  z.addEventListener('drop',function(ev){ev.preventDefault();if(ev.dataTransfer.files.length){i.files=ev.dataTransfer.files;show();}});})();`;

function Step(props: { done: boolean; active?: boolean; title: string; hint: string }) {
  return (
    <div class="relative flex gap-4">
      <div class={`w-4 h-4 rounded-full z-10 shrink-0 ${props.done ? "bg-brand shadow-[0_0_10px_rgb(var(--c-brand))]" : "bg-ink border-2 border-card"}`}></div>
      <div class={`flex-1 -mt-1 ${props.done || props.active ? "" : "opacity-40"}`}>
        <h3 class="text-xs font-bold text-fg">{props.title}</h3>
        <p class="text-[10px] text-muted">{props.hint}</p>
      </div>
    </div>
  );
}

export function OrderPage(props: { user: User | null; order: OrderView; errors?: string[] }) {
  const o = props.order;
  const expired = o.status === "pending" && o.expires_at <= new Date().toISOString();
  const bank = bankName(o.pay_card_number);
  const back = o.is_direct ? "/me/orders" : `/w/${o.wishlist_slug}`;
  const forWhom = o.is_direct ? "برای خودم" : `برای ${o.owner_name}`;
  const header = (
    <TitleBar
      title={o.status === "pending" ? "پرداخت کارت به کارت" : "جزئیات هدیه"}
      back={back}
      end={<IconButton icon="fa-print" label="چاپ" attrs={{ onclick: "event.preventDefault();print()" }} />}
    />
  );
  const giftCard = (
    <section>
      <h2 class="text-xs font-bold text-muted mb-4 px-1">محتوای کادو</h2>
      <div class="p-4 bg-card rounded-2xl border border-muted/5 flex items-center gap-4">
        <div class="w-20 h-20 rounded-xl overflow-hidden bg-ink shrink-0">
          <ImageOrGift imageKey={o.image_key} alt={o.product_title} class="w-full h-full object-cover" />
        </div>
        <div class="min-w-0">
          <h3 class="text-sm font-bold text-fg mb-1">{o.product_title}</h3>
          <p class="text-[10px] text-muted mb-1">فروشگاه: {o.shop_name} · {forWhom}</p>
          {variantLabel(o.size, o.color) && <p class="text-[10px] text-muted mb-1"><b class="text-fg">{variantLabel(o.size, o.color)}</b></p>}
          <span class="text-xs font-bold text-brand">{toman(o.amount)}</span>
        </div>
      </div>
    </section>
  );

  if (o.status === "pending") {
    return (
      <Layout title={o.is_direct ? o.product_title : `کادو برای ${o.owner_name}`} user={props.user} nav="none" header={header} bare>
        <form method="post" action={`/order/${o.token}/receipt`} enctype="multipart/form-data" id="receipt-form" class="px-6 pb-36 space-y-8">
          <section class="p-4 bg-card rounded-2xl border border-muted/10">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-16 h-16 rounded-xl overflow-hidden bg-ink shrink-0">
                <ImageOrGift imageKey={o.image_key} alt={o.product_title} class="w-full h-full object-cover" />
              </div>
              <div class="min-w-0">
                <h2 class="text-sm font-bold text-fg truncate">{o.product_title}</h2>
                <p class="text-[10px] text-muted">{forWhom} · سفارش #{fa(o.id)}</p>
              </div>
            </div>
            <div class="space-y-3 pt-4 border-t border-ink">
              <Row label={<>قیمت کالا{variantLabel(o.size, o.color) && <> ({variantLabel(o.size, o.color)})</>}</>} value={toman(o.item_price)} />
              {o.package_name && <Row label={`بسته‌بندی (${o.package_name})`} value={o.package_price ? toman(o.package_price) : "رایگان"} />}
              {o.delivery_method && <Row label={`ارسال با ${DELIVERY_LABEL[o.delivery_method]}`} value={o.delivery_fee ? toman(o.delivery_fee) : "رایگان"} />}
              <Row strong label="مبلغ قابل پرداخت" value={toman(o.amount)} />
            </div>
          </section>

          {expired && (
            <div class="rounded-2xl bg-amber-400/10 text-amber-200 px-4 py-3 text-sm">
              زمان رزرو تمام شده. اگر هنوز واریز نکرده‌اید، ممکن است شخص دیگری این آرزو را بخرد؛ اگر واریز کرده‌اید، عکس فیش را بفرستید.
            </div>
          )}

          <section class="bg-brand/5 border border-brand/20 p-5 rounded-2xl">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white"><i class="fa-solid fa-credit-card text-sm"></i></div>
              <h3 class="text-sm font-bold text-brand">۱. مبلغ را کارت به کارت کنید</h3>
            </div>
            <p class="text-xs text-muted leading-relaxed mb-5">
              مبلغ <b class="text-fg">{toman(o.amount)}</b> را به کارت زیر (مستقیم به حساب فروشگاه) واریز کنید و تصویر رسید را پایین بفرستید.
            </p>
            <div class="bg-card p-4 rounded-xl space-y-4 border border-muted/5">
              <div>
                <span class="text-[10px] text-muted block mb-1">شماره کارت مقصد</span>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-base sm:text-lg font-mono tracking-wider whitespace-nowrap text-fg dt">{formatCard(o.pay_card_number)}</span>
                  <button type="button" data-copy={o.pay_card_number} data-copied='<i class="fa-solid fa-check"></i>' class="text-brand w-9 h-9" aria-label="کپی شماره کارت">
                    <i class="fa-regular fa-copy"></i>
                  </button>
                </div>
              </div>
              <div>
                <span class="text-[10px] text-muted block mb-1">نام صاحب حساب</span>
                <span class="text-sm font-medium text-fg">{o.card_holder}</span>
              </div>
              {bank && (
                <div>
                  <span class="text-[10px] text-muted block mb-1">بانک</span>
                  <span class="text-sm font-medium text-fg">{bank}</span>
                </div>
              )}
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-[10px] text-muted block mb-1">مبلغ به ریال</span>
                  <span class="text-sm font-medium text-fg">{fa(o.amount * 10)} ریال</span>
                </div>
                <button type="button" data-copy={String(o.amount * 10)} data-copied="کپی شد ✓" class="text-[11px] text-brand">کپی مبلغ</button>
              </div>
            </div>
            {!expired && <p class="text-[10px] text-muted mt-3">این آرزو تا <span class="dt">{formatJalali(o.expires_at)}</span> برای شما رزرو است.</p>}
          </section>

          <section>
            <h3 class="text-sm font-bold text-fg mb-3 px-1">۲. عکس فیش واریز را بفرستید</h3>
            <Errors errors={props.errors} />
            <label id="dropzone" class="border-2 border-dashed border-card rounded-2xl p-8 flex flex-col items-center justify-center gap-3 bg-card/30 cursor-pointer hover:border-brand/40 transition-colors">
              <img id="receipt-preview" class="hidden max-h-64 rounded-xl" alt="پیش‌نمایش فیش" />
              <div class="w-12 h-12 rounded-full bg-card flex items-center justify-center text-muted"><i class="fa-solid fa-cloud-arrow-up text-xl"></i></div>
              <p id="dz-text" class="text-xs text-muted">تصویر رسید را اینجا رها کنید یا انتخاب کنید</p>
              <span class="text-[10px] text-muted/60">JPG، PNG یا WebP — حداکثر ۵ مگابایت</span>
              <input id="receipt-input" type="file" name="receipt" accept="image/jpeg,image/png,image/webp" required class="sr-only" />
            </label>
          </section>
          <p class="text-[11px] text-muted px-1">این صفحه مخصوص شماست؛ لینکش را نگه دارید تا وضعیت سفارش را ببینید.</p>
        </form>
        <div class="fixed bottom-0 inset-x-0 z-50 bg-ink/95 backdrop-blur-lg border-t border-card">
          <div class="max-w-3xl mx-auto p-4 safe-bottom">
            <button form="receipt-form" class="w-full py-4 bg-brand text-white rounded-2xl font-bold shadow-lg shadow-brand/20 flex items-center justify-center gap-2 active:scale-95 transition-transform">
              ارسال فیش <i class="fa-solid fa-arrow-left"></i>
            </button>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: RECEIPT_PREVIEW }} />
      </Layout>
    );
  }

  const paid = o.status === "paid" || o.status === "shipped" || o.status === "delivered";
  const shipped = o.status === "shipped" || o.status === "delivered";
  const icon = o.status === "rejected" ? "fa-circle-xmark" : paid ? (shipped ? "fa-truck-fast" : "fa-circle-check") : "fa-clock-rotate-left";
  return (
    <Layout title={o.is_direct ? o.product_title : `کادو برای ${o.owner_name}`} user={props.user} nav="none" header={header} bare>
      <div class="px-6 pb-12 space-y-8">
        <section class="p-6 bg-card rounded-3xl border border-muted/5">
          <div class="flex items-center justify-between mb-8">
            <div>
              <p class="text-[10px] text-muted mb-1">شماره سفارش: #{fa(o.id)}</p>
              <h2 class={`text-sm font-black ${o.status === "rejected" ? "text-red-300" : "text-brand"}`}>{orderStatusLabel(o)}</h2>
            </div>
            <div class="w-12 h-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center text-xl"><i class={`fa-solid ${icon}`}></i></div>
          </div>
          {o.status === "rejected" && o.cancel_kind === "out_of_stock" ? (
            <div class="text-sm text-red-300 leading-relaxed space-y-2">
              <p>متأسفانه این کالا ناموجود شد و فروشگاه سفارش را لغو کرد{o.reject_reason ? `: ${o.reject_reason}` : "."}</p>
              {o.paid_at && <p class="text-fg">مبلغ {toman(o.amount)} به شما برگردانده می‌شود.{o.refund_note && <> بازگشت وجه: <b>{o.refund_note}</b></>}</p>}
              {!o.paid_at && <p class="text-muted text-xs">اگر مبلغ را واریز کرده‌اید، با رسید با فروشگاه {o.shop_name} تماس بگیرید.</p>}
            </div>
          ) : o.status === "rejected" ? (
            <p class="text-sm text-red-300 leading-relaxed">
              فروشگاه دریافت این واریز را تأیید نکرد{o.reject_reason ? `: ${o.reject_reason}` : "."} اگر مبلغ از حساب شما کم شده، با رسید با
              فروشگاه {o.shop_name} تماس بگیرید.
            </p>
          ) : (
            <div class="space-y-6 relative pr-4">
              <div class="absolute right-[7px] top-2 bottom-2 w-[2px] bg-ink"></div>
              <Step done title={o.is_direct ? "پرداخت شما" : `پرداخت توسط ${o.giver_name}`} hint="فیش برای فروشگاه ارسال شد" />
              <Step done={paid} active={!paid} title="تأیید واریز توسط فروشگاه" hint={paid ? "مبلغ دریافت شد" : "در حال بررسی رسید..."} />
              <Step
                done={shipped}
                title="ارسال کادو"
                hint={shipped ? (o.tracking_code ? `کد رهگیری: ${o.tracking_code}` : "ارسال شد") : "پس از تأیید واریز"}
              />
            </div>
          )}
        </section>
        {o.change_status === "pending" && (
          <div class="rounded-2xl bg-amber-400/10 text-amber-200 px-4 py-3 text-sm leading-7">
            🔁 کالا{variantLabel(o.size, o.color) ? ` (${variantLabel(o.size, o.color)})` : ""} تمام شده و فروشگاه {variantLabel(o.change_size, o.change_color) || "گزینه دیگری"} را پیشنهاد داده
            {o.is_direct ? "؛ در پروفایل خود پاسخ دهید." : "؛ منتظر پاسخ گیرنده است."}
            {o.is_direct && <a href={`/me/changes/${o.id}`} class="block mt-2 text-brand font-bold">پاسخ به پیشنهاد</a>}
          </div>
        )}
        {o.change_status === "accepted" && (
          <div class="rounded-2xl bg-ok/15 text-green-300 px-4 py-3 text-sm">
            ✓ تغییر پذیرفته شد{variantLabel(o.size, o.color) ? ` (${variantLabel(o.size, o.color)})` : ""}{o.change_reply ? `: ${o.change_reply}` : ""}.
          </div>
        )}
        {paid && <p class="text-center text-sm">🎉 ممنون از مهربانی‌تان!</p>}
        {giftCard}
        {o.gift_message && (
          <section>
            <h2 class="text-xs font-bold text-muted mb-4 px-1">پیام شما برای {o.owner_name}</h2>
            <div class="p-5 bg-brand/5 border border-brand/20 rounded-3xl relative">
              <i class="fa-solid fa-quote-right absolute -top-3 -right-3 w-8 h-8 bg-brand text-white rounded-full flex items-center justify-center text-xs"></i>
              <p class="text-sm text-fg leading-relaxed whitespace-pre-wrap">{o.gift_message}</p>
            </div>
          </section>
        )}
        {o.receipt_key && (
          <section>
            <h2 class="text-xs font-bold text-muted mb-4 px-1">رسید بانکی</h2>
            <a href={`/order/${o.token}/receipt`} target="_blank" class="block p-2 bg-card rounded-2xl border border-muted/5 overflow-hidden">
              <img class="w-full max-h-[480px] object-contain rounded-xl" src={`/order/${o.token}/receipt`} alt="رسید واریز" loading="lazy" />
            </a>
          </section>
        )}
        <a href={back} class="block text-center py-3 rounded-2xl bg-card text-sm">{o.is_direct ? "خریدهای من" : "بازگشت به لیست آرزو"}</a>
      </div>
    </Layout>
  );
}

/** "Buy for myself": size and the buyer's own delivery address, then the usual checkout. */
export function DirectBuyPage(props: {
  user: User;
  product: ProductWithShop;
  image: string;
  available?: Record<string, number> | null;
  values: Record<string, string>;
  errors?: string[];
}) {
  const avail = props.available ?? null;
  const p = props.product;
  const v = props.values;
  const opts = variants(p).filter((x) => x.label);
  const input = "w-full bg-card border border-muted/10 rounded-xl px-4 py-3 text-sm text-fg outline-hidden focus:border-brand";
  const label = "block text-xs text-muted mb-1.5 px-1";
  return (
    <Layout title={`خرید ${p.title}`} user={props.user} nav="none" header={<TitleBar title="خرید مستقیم" back={`/p/${p.id}`} />} bare>
      <form method="post" action={`/p/${p.id}/buy`} id="direct" class="px-6 pb-36 space-y-6">
        <section class="p-4 bg-card rounded-2xl border border-muted/10 flex items-center gap-4">
          <div class="w-16 h-16 rounded-xl overflow-hidden bg-ink shrink-0">
            <ImageOrGift imageKey={props.image} alt={p.title} class="w-full h-full object-cover" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-bold text-fg truncate">{p.title}</h2>
            <p class="text-[10px] text-muted">{p.shop_name}</p>
            <p class="text-xs font-bold text-brand mt-1">{toman(p.price)}</p>
          </div>
        </section>
        <Errors errors={props.errors} />
        {opts.length > 0 && (
          <div>
            <label class={label}>سایز / رنگ</label>
            <select name="variant" required class={input}>
              <option value="">انتخاب کنید…</option>
              {opts.map((o) => (
                <option value={o.key} selected={v.variant === o.key} disabled={!!avail && !avail[o.key]}>
                  {o.label}{avail && !avail[o.key] ? " — ناموجود" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <section class="space-y-4">
          <h3 class="text-sm font-bold px-1">ارسال به</h3>
          <div>
            <label class={label}>نام گیرنده</label>
            <input name="recipient_name" value={v.recipient_name ?? ""} required maxlength={80} class={input} />
          </div>
          <div>
            <label class={label}>موبایل گیرنده</label>
            <input name="recipient_phone" value={v.recipient_phone ?? ""} required inputmode="tel" class={`${input} ltr text-left`} />
          </div>
          <div>
            <label class={label}>شهر</label>
            <input name="city" value={v.city ?? ""} list="cities" required maxlength={40} autocomplete="off" class={input} />
            <datalist id="cities">{CITIES.map((c) => <option value={c} />)}</datalist>
          </div>
          <div>
            <label class={label}>آدرس کامل</label>
            <textarea name="address" required maxlength={400} rows={3} class={input}>{v.address ?? ""}</textarea>
          </div>
          <div>
            <label class={label}>کد پستی (۱۰ رقم)</label>
            <input name="postal_code" value={v.postal_code ?? ""} required inputmode="numeric" maxlength={12} class={`${input} ltr text-left`} />
          </div>
          <div>
            <label class={label}>یادداشت برای فروشگاه (اختیاری)</label>
            <input name="note" value={v.note ?? ""} maxlength={200} placeholder="مثلاً رنگ" class={input} />
          </div>
        </section>
        <p class="text-[11px] text-muted leading-relaxed px-1">
          <i class="fa-solid fa-lock ml-1"></i>
          در قدم بعد بسته‌بندی و روش ارسال را انتخاب می‌کنید و مبلغ را مستقیم به کارت فروشگاه واریز می‌کنید. آدرس فقط بعد از تأیید واریز
          به فروشگاه نشان داده می‌شود.
        </p>
      </form>
      <div class="fixed bottom-0 inset-x-0 z-50 bg-ink/95 backdrop-blur-lg border-t border-card">
        <div class="max-w-3xl mx-auto p-4 safe-bottom">
          <button form="direct" class="w-full py-4 bg-brand text-white rounded-2xl font-bold shadow-lg shadow-brand/20 flex items-center justify-center gap-2 active:scale-95 transition-transform">
            ادامه: روش ارسال و پرداخت <i class="fa-solid fa-arrow-left"></i>
          </button>
        </div>
      </div>
    </Layout>
  );
}
