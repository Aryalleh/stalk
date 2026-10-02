import { Hono } from "hono";
import { CSS_URL } from "./assets";
import type { C, Env } from "./env";
import { render } from "./render";
import { siteDescription } from "./settings";
import { Layout } from "./shop/views/layout";
import appleTouchIcon from "./static/apple-touch-icon.png";
import icon192 from "./static/icon-192.png";
import icon512 from "./static/icon-512.png";
import iconMaskable from "./static/icon-maskable-512.png";
import iconSvg from "./static/icon.svg";

// Installable web app (PWA): manifest, icons, an offline page and a small service worker.
// The worker never caches pages (they hold personal data); it only serves /offline when the
// network is down, and caches the stylesheet, icons and public images.

export const pwa = new Hono<Env>();

const PNG: Record<string, ArrayBuffer> = {
  "/static/icon-192.png": icon192,
  "/static/icon-512.png": icon512,
  "/static/icon-maskable-512.png": iconMaskable,
  "/apple-touch-icon.png": appleTouchIcon,
};
for (const [path, body] of Object.entries(PNG)) {
  pwa.get(path, (c) => c.body(body, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }));
}
const svg = (c: C) =>
  c.body(iconSvg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
pwa.get("/static/icon.svg", svg);
pwa.get("/favicon.ico", svg);

pwa.get("/manifest.webmanifest", (c) => {
  const s = c.get("settings");
  return c.json(
    {
      name: s.site_name,
      short_name: s.site_name,
      description: siteDescription(s),
      lang: "fa",
      dir: "rtl",
      id: "/",
      start_url: "/?source=pwa",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#f4f6fa",
      theme_color: "#ffffff",
      categories: ["shopping", "lifestyle"],
      icons: [
        { src: "/static/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/static/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/static/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "/static/icon.svg", sizes: "any", type: "image/svg+xml" },
      ],
      shortcuts: [
        { name: "لیست‌های آرزوی من", url: "/me/wishlists", icons: [{ src: "/static/icon-192.png", sizes: "192x192" }] },
        { name: "جستجوی هدیه", url: "/search", icons: [{ src: "/static/icon-192.png", sizes: "192x192" }] },
        { name: "پنل فروشگاه", url: "/panel", icons: [{ src: "/static/icon-192.png", sizes: "192x192" }] },
      ],
    },
    200,
    { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  );
});

// Bump with every stylesheet change so old caches are dropped.
const VERSION = CSS_URL.split("v=")[1] ?? "1";

const SERVICE_WORKER = `
const STATIC = 'static-${VERSION}', IMAGES = 'images-v1', OFFLINE = '/offline';
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(STATIC).then(function (c) { return c.addAll([OFFLINE, '${CSS_URL}', '/static/icon-192.png']); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== STATIC && k !== IMAGES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(function () { return caches.match(OFFLINE); }));
    return;
  }
  if (url.pathname.indexOf('/static/') === 0) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { var copy = res.clone(); caches.open(STATIC).then(function (c) { c.put(req, copy); }); return res; });
    }));
    return;
  }
  if (url.pathname.indexOf('/img/') === 0) {
    // Public product/shop/avatar photos: show the cached copy at once, refresh it in the background.
    e.respondWith(caches.open(IMAGES).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});`;

pwa.get("/sw.js", (c) =>
  c.body(SERVICE_WORKER, 200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" }),
);

pwa.get("/offline", (c) =>
  render(
    c,
    <Layout title="آفلاین" user={null} nav="none" bare>
      <div class="px-6 py-24 text-center">
        <div class="text-6xl mb-6">📡</div>
        <h1 class="text-xl font-bold mb-3">اتصال اینترنت برقرار نیست</h1>
        <p class="text-sm text-muted leading-relaxed mb-8">به‌محض وصل شدن دوباره، صفحه را تازه کنید.</p>
        <button type="button" onclick="location.reload()" class="px-6 py-3 rounded-2xl bg-brand text-white font-bold">تلاش دوباره</button>
      </div>
    </Layout>,
  ),
);
