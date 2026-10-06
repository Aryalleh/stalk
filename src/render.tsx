import { createContext, useContext } from "hono/jsx";
import type { Child } from "hono/jsx";
import type { StatusCode } from "hono/utils/http-status";
import type { C } from "./env";
import { DEFAULTS, type Settings } from "./settings";

/** The request's settings plus the site's public origin (for absolute URLs in meta tags). */
export type Site = Settings & {
  origin: string;
  path: string;
  signedIn: boolean;
  /** Set while a platform admin is signed in as this user (shows the "back to admin" bar). */
  actingAs: { admin: string; user: string } | null;
};

const SiteContext = createContext<Site>({ ...DEFAULTS, origin: "", path: "/", signedIn: false, actingAs: null });

/** Settings for the current request, readable from any component. */
export const useSite = () => useContext(SiteContext);

export const siteOrigin = (c: C) => (c.get("settings").site_url || new URL(c.req.url).origin).replace(/\/$/, "");

/** Render a page with the request's settings available to its components. */
export function render(c: C, node: Child, status: StatusCode = 200) {
  const admin = c.get("impersonator");
  const user = c.get("user");
  const site: Site = {
    ...c.get("settings"),
    origin: siteOrigin(c),
    path: new URL(c.req.url).pathname,
    signedIn: !!user,
    actingAs: admin && user ? { admin: admin.name, user: user.name || user.phone } : null,
  };
  return c.html(<SiteContext.Provider value={site}>{node}</SiteContext.Provider>, status as never);
}
