import type { Child } from "hono/jsx";
import type { User } from "../session";

const CSS = `
:root{--bg:#f5f6f8;--card:#fff;--text:#1d2330;--muted:#6b7280;--line:#e3e6eb;--accent:#2563eb;--accent-text:#fff;--danger:#c62828;--ok:#1b7f3b;--hl:#eef3ff}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--text:#e6e8ec;--muted:#9aa3af;--line:#2e333c;--accent:#4f8cff;--hl:#1e2a44}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 Vazirmatn,Tahoma,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header{background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header .brand{font-weight:700;font-size:17px;color:var(--text)}header .sp{flex:1}
main{max-width:1100px;margin:20px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 14px}h2{font-size:16px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px 16px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:3px}
input,textarea,select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--text);font:inherit}
textarea{min-height:80px}.ltr{direction:ltr;text-align:left}
button,.btn{display:inline-block;padding:8px 16px;border:0;border-radius:7px;background:var(--accent);color:var(--accent-text);font:inherit;cursor:pointer}
.btn.secondary,button.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
button.danger{background:var(--danger)}
.err{color:var(--danger);font-size:13px}.errbox{background:#fdecea;color:#8a1c1c;padding:10px 14px;border-radius:7px;margin-bottom:14px}
.okbox{background:#e7f6ec;color:#14532d;padding:10px 14px;border-radius:7px;margin-bottom:14px}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}
th{color:var(--muted);font-weight:500;white-space:nowrap}tr:hover td{background:var(--hl)}
.muted{color:var(--muted)}.nowrap{white-space:nowrap}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.tag{font-size:12px;padding:1px 8px;border-radius:10px;background:var(--hl)}
.dt{direction:ltr;unicode-bidi:isolate;display:inline-block}
.pager{display:flex;gap:12px;margin-top:12px}
`;

export function Layout(props: { title: string; user?: User | null; children?: Child }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · CRM</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        {props.user && (
          <header>
            <a class="brand" href="/">CRM</a>
            <a href="/">مخاطبین</a>
            <a href="/contacts/new">+ مخاطب جدید</a>
            <a href="/history">سوابق تغییرات</a>
            <a href="/fields">فیلدهای اضافه</a>
            {props.user.is_admin ? <a href="/users">کاربران</a> : null}
            <span class="sp" />
            <a href="/account" class="muted">{props.user.username}</a>
            <form method="post" action="/logout" style="margin:0">
              <button class="secondary" style="padding:3px 10px">خروج</button>
            </form>
          </header>
        )}
        <main>{props.children}</main>
      </body>
    </html>
  );
}

export function Errors(props: { errors?: string[] }) {
  if (!props.errors?.length) return null;
  return (
    <div class="errbox">
      {props.errors.map((e) => (
        <div>{e}</div>
      ))}
    </div>
  );
}
