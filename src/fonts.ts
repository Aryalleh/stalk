import { Hono } from "hono";
import faBrands from "@fortawesome/fontawesome-free/webfonts/fa-brands-400.woff2";
import faRegular from "@fortawesome/fontawesome-free/webfonts/fa-regular-400.woff2";
import faSolid from "@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2";
import faV4 from "@fortawesome/fontawesome-free/webfonts/fa-v4compatibility.woff2";
import vazirmatn from "vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2";
import type { Env } from "./env";

// Fonts bundled into the Worker (from the npm packages) and served from the site itself: faster
// first paint than third-party CDNs, no outside requests, and they load even where CDNs are slow.

export const fonts = new Hono<Env>();

const FILES: Record<string, ArrayBuffer> = {
  // Font Awesome's stylesheet (inlined into app.css) refers to these as ../webfonts/<file>.
  "/webfonts/fa-brands-400.woff2": faBrands,
  "/webfonts/fa-regular-400.woff2": faRegular,
  "/webfonts/fa-solid-900.woff2": faSolid,
  "/webfonts/fa-v4compatibility.woff2": faV4,
  "/static/fonts/vazirmatn.woff2": vazirmatn,
};

for (const [path, body] of Object.entries(FILES)) {
  fonts.get(path, (c) =>
    c.body(body, 200, { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" }),
  );
}
