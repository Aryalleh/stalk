import { createContext, useContext } from "hono/jsx";
import type { Child } from "hono/jsx";
import type { StatusCode } from "hono/utils/http-status";
import type { C } from "./env";
import { DEFAULTS, type Settings } from "./settings";

const SiteContext = createContext<Settings>({ ...DEFAULTS });

/** Settings for the current request, readable from any component. */
export const useSite = () => useContext(SiteContext);

/** Render a page with the request's settings available to its components. */
export function render(c: C, node: Child, status: StatusCode = 200) {
  return c.html(<SiteContext.Provider value={c.get("settings")}>{node}</SiteContext.Provider>, status as never);
}
