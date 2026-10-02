import type { Site } from "./render";
import { siteDescription } from "./settings";

// schema.org JSON-LD builders shared by the pages (search engines and AI answer engines read these).

export function organizationLd(site: Site) {
  const sameAs = [site.bale_bot_username && `https://ble.ir/${site.bale_bot_username}`, site.telegram_bot_username && `https://t.me/${site.telegram_bot_username}`].filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${site.origin}/#organization`,
    name: site.site_name,
    url: `${site.origin}/`,
    logo: `${site.origin}/static/icon-512.png`,
    description: siteDescription(site),
    areaServed: { "@type": "Country", name: "Iran" },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteLd(site: Site) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${site.origin}/#website`,
    name: site.site_name,
    url: `${site.origin}/`,
    inLanguage: "fa-IR",
    publisher: { "@id": `${site.origin}/#organization` },
    potentialAction: { "@type": "SearchAction", target: `${site.origin}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
  };
}

export function breadcrumbLd(site: Site, items: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: site.origin + path })),
  };
}

export function itemListLd(site: Site, name: string, items: { id: number; title: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: items.slice(0, 30).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${site.origin}/p/${p.id}`, name: p.title })),
  };
}

/** Plain-text summary for meta descriptions (about 155 characters, cut at a word). */
export function summary(text: string, max = 155) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : max) + "…";
}
