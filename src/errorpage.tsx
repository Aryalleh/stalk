// 404 / 403 responses: the designed page for browsers, plain text for anything else (images, APIs, bots).
import type { C } from "./env";
import { render } from "./render";
import { ErrorPage } from "./shop/views/errors";

const wantsHtml = (c: C) => (c.req.header("accept") ?? "").includes("text/html");

export function notFoundPage(c: C, message?: string) {
  if (!wantsHtml(c)) return c.text(message ?? "پیدا نشد", 404);
  return render(c, <ErrorPage code={404} user={c.get("user") ?? null} message={message} />, 404);
}

export function forbiddenPage(c: C, message?: string) {
  if (!wantsHtml(c)) return c.text(message ?? "دسترسی ندارید", 403);
  return render(c, <ErrorPage code={403} user={c.get("user") ?? null} message={message} />, 403);
}
