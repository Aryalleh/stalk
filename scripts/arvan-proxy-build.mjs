// Builds the ArvanCloud Edge Computing proxy (deploy/arvan-proxy/proxy.mjs) into one file with its
// settings baked in (Arvan's runtime didn't expose environment variables to the code in our tests):
//   WORKER_HOST=gift-shop.NAME.workers.dev PROXY_SECRET=… npm run arvan-proxy:build
// or put both in .env.arvan-proxy (not in git). Output: dist/arvan-proxy.js (service-worker format,
// addEventListener("fetch")); add --format=esm for `export default { fetch }`.
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";

const env = { ...process.env };
if (existsSync(".env.arvan-proxy")) {
  for (const line of readFileSync(".env.arvan-proxy", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && !env[m[1]]) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const workerHost = (env.WORKER_HOST ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const secret = env.PROXY_SECRET ?? "";
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(workerHost)) throw new Error("set WORKER_HOST, e.g. gift-shop.NAME.workers.dev");
if (secret.length < 16) throw new Error("set PROXY_SECRET (the same value as `npx wrangler secret put PROXY_SECRET` on the Worker)");

const format = process.argv.includes("--format=esm") ? "esm" : "sw";
const entry =
  format === "esm"
    ? `import { makeProxy } from "./deploy/arvan-proxy/proxy.mjs";
const handle = makeProxy({ workerHost: __WORKER__, secret: __SECRET__ });
export default { fetch: (request) => handle(request) };`
    : `import { makeProxy } from "./deploy/arvan-proxy/proxy.mjs";
const handle = makeProxy({ workerHost: __WORKER__, secret: __SECRET__ });
addEventListener("fetch", (event) => event.respondWith(handle(event.request)));`;

await build({
  stdin: { contents: entry, resolveDir: ".", loader: "js" },
  outfile: "dist/arvan-proxy.js",
  bundle: true,
  format: format === "esm" ? "esm" : "iife",
  platform: "neutral",
  target: "es2020",
  minify: true,
  legalComments: "none",
  define: { __WORKER__: JSON.stringify(workerHost), __SECRET__: JSON.stringify(secret) },
  logLevel: "warning",
});
console.log(`dist/arvan-proxy.js → https://${workerHost} (${format}); the file contains the secret: don't share or commit it`);
