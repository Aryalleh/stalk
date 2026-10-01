import type { Child } from "hono/jsx";
import type { User } from "../session";

const CSS = `
:root{--bg:#faf7f5;--card:#fff;--text:#2a2230;--muted:#7a7080;--line:#ece6ea;--accent:#d6336c;--accent-2:#f8e1ea;--accent-text:#fff;--ok:#1b7f3b;--ok-bg:#e5f5ea;--warn-bg:#fff4dc;--danger:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#17131a;--card:#221c26;--text:#efe8f0;--muted:#a79daf;--line:#352c3b;--accent:#ff5c93;--accent-2:#3a2230;--ok-bg:#183424;--warn-bg:#3a3018}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.8 Vazirmatn,Tahoma,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header{background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header .brand{font-weight:700;font-size:19px;color:var(--accent)}header .sp{flex:1}
main{max-width:1100px;margin:22px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:16px}
h1{font-size:22px;margin:0 0 14px}h2{font-size:17px;margin:0 0 12px}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 3px}
input,textarea,select{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--text);font:inherit}
textarea{min-height:80px}.ltr{direction:ltr;text-align:left}
button,.btn{display:inline-block;padding:9px 18px;border:0;border-radius:9px;background:var(--accent);color:var(--accent-text);font:inherit;cursor:pointer;text-decoration:none!important}
.btn.secondary,button.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
button.small,.btn.small{padding:3px 12px;font-size:13px}
button:disabled{opacity:.5;cursor:not-allowed}
.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.product{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;color:var(--text)}
.product:hover{text-decoration:none;border-color:var(--accent)}
.thumb{aspect-ratio:1/1;background:var(--accent-2);display:flex;align-items:center;justify-content:center;font-size:42px;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover}
.product .info{padding:10px 12px}.product .title{font-weight:500}
.price{color:var(--accent);font-weight:700}.muted{color:var(--muted)}.small{font-size:13px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sp{flex:1}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}
@media (max-width:720px){.two{grid-template-columns:1fr}}
.errbox{background:#fdecea;color:#8a1c1c;padding:10px 14px;border-radius:9px;margin-bottom:14px}
.okbox{background:var(--ok-bg);color:var(--ok);padding:10px 14px;border-radius:9px;margin-bottom:14px}
.warnbox{background:var(--warn-bg);padding:10px 14px;border-radius:9px;margin-bottom:14px}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}th{color:var(--muted);font-weight:500;white-space:nowrap}
.tag{font-size:12px;padding:1px 9px;border-radius:10px;background:var(--accent-2);white-space:nowrap}
.tag.ok{background:var(--ok-bg);color:var(--ok)}
.item{display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}
.item:last-child{border-bottom:0}.item .thumb{width:84px;flex:none;border-radius:10px}
.item .body{flex:1;min-width:0}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:6px;max-width:220px}.bar>span{display:block;height:100%;background:var(--ok)}
.share{display:flex;gap:8px}.share input{direction:ltr}
.dt{direction:ltr;unicode-bidi:isolate;display:inline-block}
nav.tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}nav.tabs a{padding:6px 14px;border-radius:9px;background:var(--card);border:1px solid var(--line)}
nav.tabs a.on{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}
`;

export function Layout(props: { title: string; user: User | null; children?: Child; hasShop?: boolean }) {
  const u = props.user;
  return (
    <html lang="fa" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · کادوچی</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header>
          <a class="brand" href="/">🎁 کادوچی</a>
          <a href="/">محصولات</a>
          {u && <a href="/me/wishlists">لیست‌های آرزوی من</a>}
          <span class="sp" />
          {u ? (
            <>
              <a href="/panel">پنل فروشگاه</a>
              {u.is_admin ? <a href="/admin">مدیریت</a> : null}
              <span class="muted">{u.name}</span>
              <form method="post" action="/logout" style="margin:0">
                <button class="secondary small">خروج</button>
              </form>
            </>
          ) : (
            <>
              <a href="/login">ورود</a>
              <a class="btn small" href="/register">ثبت‌نام</a>
            </>
          )}
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

export function Errors(props: { errors?: (string | undefined)[] }) {
  const list = (props.errors ?? []).filter(Boolean);
  if (!list.length) return null;
  return <div class="errbox">{list.map((e) => <div>{e}</div>)}</div>;
}

export function Thumb(props: { imageKey: string; alt: string }) {
  return (
    <div class="thumb">
      {props.imageKey ? <img src={`/img/${props.imageKey}`} alt={props.alt} loading="lazy" /> : "🎁"}
    </div>
  );
}
