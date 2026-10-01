import type { User } from "../auth";
import type { ContactRow, FieldDef } from "../db";
import { CONTACT_KEY, CORE_FIELDS, SECTIONS, contactName, type ContactData } from "../fields";
import type { Extras, LogRow, Snapshot } from "../history";
import { formatJalali } from "../jalali";
import { Errors, Layout } from "./layout";

const ACTION_LABEL: Record<string, string> = { create: "ایجاد", update: "ویرایش", delete: "حذف" };

export function LoginPage(props: { error?: string }) {
  return (
    <Layout title="ورود">
      <div class="card" style="max-width:380px;margin:60px auto">
        <h1>ورود به CRM</h1>
        <Errors errors={props.error ? [props.error] : []} />
        <form method="post" action="/login">
          <label>نام کاربری</label>
          <input name="username" class="ltr" autocomplete="username" required autofocus />
          <label style="margin-top:10px">رمز عبور</label>
          <input name="password" type="password" class="ltr" autocomplete="current-password" required />
          <p><button>ورود</button></p>
        </form>
      </div>
    </Layout>
  );
}

export function SetupPage(props: { error?: string; configured: boolean }) {
  return (
    <Layout title="راه‌اندازی">
      <div class="card" style="max-width:420px;margin:60px auto">
        <h1>ساخت اولین مدیر</h1>
        {!props.configured ? (
          <p class="errbox">
            ابتدا secret به نام <code>SETUP_TOKEN</code> را تنظیم کنید:
            <br />
            <code class="ltr">npx wrangler secret put SETUP_TOKEN</code>
          </p>
        ) : (
          <form method="post" action="/setup">
            <Errors errors={props.error ? [props.error] : []} />
            <label>SETUP_TOKEN</label>
            <input name="token" type="password" class="ltr" required />
            <label style="margin-top:10px">نام کاربری مدیر</label>
            <input name="username" class="ltr" required />
            <label style="margin-top:10px">رمز عبور (حداقل ۱۰ کاراکتر)</label>
            <input name="password" type="password" class="ltr" minlength={10} required />
            <p><button>ساخت</button></p>
          </form>
        )}
      </div>
    </Layout>
  );
}

function Pager(props: { page: number; hasNext: boolean; base: string }) {
  const sep = props.base.includes("?") ? "&" : "?";
  return (
    <div class="pager">
      {props.page > 1 && <a href={`${props.base}${sep}page=${props.page - 1}`}>« قبلی</a>}
      {props.hasNext && <a href={`${props.base}${sep}page=${props.page + 1}`}>بعدی »</a>}
    </div>
  );
}

export function ListPage(props: { user: User; q: string; page: number; rows: ContactRow[]; hasNext: boolean }) {
  const base = props.q ? `/?q=${encodeURIComponent(props.q)}` : "/";
  return (
    <Layout title="مخاطبین" user={props.user}>
      <div class="card">
        <form method="get" action="/" class="row">
          <input name="q" value={props.q} placeholder="جستجو در همه فیلدها: نام، شماره، کد ملی، آیدی، ..." style="flex:1;min-width:220px" />
          <button>جستجو</button>
          <a class="btn secondary" href={`/export.csv${props.q ? `?q=${encodeURIComponent(props.q)}` : ""}`}>خروجی اکسل (CSV)</a>
        </form>
      </div>
      <div class="card wrap">
        {props.rows.length === 0 ? (
          <p class="muted">موردی پیدا نشد.</p>
        ) : (
          <table>
            <thead>
              <tr><th>نام</th><th>شماره تماس</th><th>کد ملی</th><th>تلگرام</th><th>اینستاگرام</th><th>آخرین ویرایش</th></tr>
            </thead>
            <tbody>
              {props.rows.map((c) => (
                <tr>
                  <td><a href={`/contacts/${c.id}`}>{contactName(c)}</a></td>
                  <td class="ltr nowrap">{c.phone}</td>
                  <td class="ltr">{c.national_code}</td>
                  <td class="ltr">{c.telegram_id}</td>
                  <td class="ltr">{c.instagram_id}</td>
                  <td class="nowrap muted"><span class="dt">{formatJalali(c.updated_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={props.page} hasNext={props.hasNext} base={base} />
      </div>
    </Layout>
  );
}

function FieldInput(props: { name: string; label: string; kind: string; value: string; error?: string }) {
  const ltr = ["phone", "handle", "national", "postal"].includes(props.kind);
  const wide = props.kind === "textarea" ? "grid-column:1/-1" : "";
  return (
    <div style={wide}>
      <label for={props.name}>{props.label}</label>
      {props.kind === "textarea" ? (
        <textarea id={props.name} name={props.name}>{props.value}</textarea>
      ) : (
        <input
          id={props.name}
          name={props.name}
          value={props.value}
          class={ltr ? "ltr" : ""}
          inputmode={props.kind === "text" ? undefined : props.kind === "handle" ? "text" : "tel"}
        />
      )}
      {props.error && <div class="err">{props.error}</div>}
    </div>
  );
}

export function ContactPage(props: {
  user: User;
  contact: ContactRow | null;
  data: ContactData;
  extras: Extras;
  defs: FieldDef[];
  errors?: Record<string, string>;
  formErrors?: string[];
  logs?: LogRow[];
  saved?: boolean;
}) {
  const c = props.contact;
  const title = c ? contactName(c) : "مخاطب جدید";
  return (
    <Layout title={title} user={props.user}>
      <h1>{title}</h1>
      {props.saved && <div class="okbox">ذخیره شد.</div>}
      <Errors errors={props.formErrors} />
      <form method="post" action={c ? `/contacts/${c.id}` : "/contacts/new"}>
        {SECTIONS.map((section) => (
          <div class="card">
            <h2>{section}</h2>
            <div class="grid">
              {CORE_FIELDS.filter((f) => f.section === section).map((f) => (
                <FieldInput name={f.name} label={f.label} kind={f.kind} value={props.data[f.name] ?? ""} error={props.errors?.[f.name]} />
              ))}
            </div>
          </div>
        ))}
        <div class="card">
          <h2>
            اطلاعات اضافه <a href="/fields" style="font-size:13px;font-weight:400">(تعریف فیلد جدید)</a>
          </h2>
          <div class="grid">
            {props.defs.map((d) => (
              <FieldInput name={`extra_${d.id}`} label={d.name} kind="text" value={props.extras.get(d.id) ?? ""} />
            ))}
          </div>
        </div>
        <div class="row">
          <button>ذخیره</button>
          {c && <span class="muted">ایجاد: <span class="dt">{formatJalali(c.created_at)}</span> · آخرین ویرایش: <span class="dt">{formatJalali(c.updated_at)}</span></span>}
        </div>
      </form>
      {c && (
        <>
          <div class="card" style="margin-top:16px">
            <div class="row" style="justify-content:space-between">
              <h2 style="margin:0">سابقه تغییرات</h2>
              <a class="btn secondary" href={`/contacts/${c.id}/snapshot`}>وضعیت پرونده در یک تاریخ دلخواه</a>
            </div>
            <LogTable logs={props.logs ?? []} showContact={false} />
          </div>
          <form method="post" action={`/contacts/${c.id}/delete`} onsubmit="return confirm('این مخاطب حذف شود؟ سابقه تغییراتش باقی می‌ماند.')">
            <button class="danger">حذف مخاطب</button>
          </form>
        </>
      )}
    </Layout>
  );
}

export function LogTable(props: { logs: LogRow[]; showContact: boolean }) {
  const rows = props.logs.filter((l) => props.showContact || l.field_name !== CONTACT_KEY);
  if (!rows.length) return <p class="muted">تغییری ثبت نشده است.</p>;
  return (
    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th>زمان</th>
            {props.showContact && <th>مخاطب</th>}
            <th>فیلد</th><th>عملیات</th><th>مقدار قبلی</th><th>مقدار جدید</th><th>کاربر</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr>
              <td class="nowrap"><span class="dt">{formatJalali(l.changed_at)}</span></td>
              {props.showContact && <td><a href={`/contacts/${l.contact_id}`}>{l.contact_repr}</a></td>}
              <td>
                {l.field_name === CONTACT_KEY ? (
                  l.field_label
                ) : (
                  <a href={`/contacts/${l.contact_id}/history?field=${encodeURIComponent(l.field_name)}`} title="تاریخچه همین فیلد">{l.field_label}</a>
                )}
              </td>
              <td><span class="tag">{ACTION_LABEL[l.action]}</span></td>
              <td>{l.old_value || "—"}</td>
              <td>{l.new_value || "—"}</td>
              <td class="muted">{l.username || "—"}</td>
              <td class="nowrap"><a href={`/contacts/${l.contact_id}/snapshot?at=${encodeURIComponent(formatJalali(l.changed_at))}`}>وضعیت در آن لحظه</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FieldHistoryPage(props: { user: User; contactId: number; name: string; label: string; logs: LogRow[] }) {
  return (
    <Layout title={`تاریخچه ${props.label}`} user={props.user}>
      <h1>
        تاریخچه «{props.label}» — <a href={`/contacts/${props.contactId}`}>{props.name}</a>
      </h1>
      <div class="card"><LogTable logs={props.logs} showContact={false} /></div>
    </Layout>
  );
}

export function SnapshotPage(props: { user: User; contactId: number; name: string; atText: string; snap: Snapshot | null; error?: string }) {
  const s = props.snap;
  return (
    <Layout title="وضعیت در تاریخ" user={props.user}>
      <h1>
        وضعیت پرونده <a href={`/contacts/${props.contactId}`}>{props.name}</a>
      </h1>
      <div class="card">
        <form method="get" class="row">
          <label style="margin:0">تاریخ شمسی:</label>
          <input name="at" value={props.atText} class="ltr" placeholder="1405/07/09 14:30" style="max-width:220px" />
          <button>نمایش</button>
        </form>
      </div>
      <Errors errors={props.error ? [props.error] : []} />
      {s && (
        <div class="card wrap">
          {!s.exists && !s.deleted ? (
            <p class="muted">در این تاریخ هنوز این مخاطب ثبت نشده بود.</p>
          ) : (
            <>
              {s.deleted && <div class="errbox">در این تاریخ مخاطب حذف شده بود. آخرین مقادیر قبل از حذف:</div>}
              <table>
                <thead><tr><th>فیلد</th><th>مقدار در آن تاریخ</th></tr></thead>
                <tbody>
                  {[...s.fields, ...s.extras].map(([label, value]) => (
                    <tr><td>{label}</td><td style="white-space:pre-wrap">{value || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}

export function HistoryPage(props: { user: User; logs: LogRow[]; page: number; hasNext: boolean }) {
  return (
    <Layout title="سوابق تغییرات" user={props.user}>
      <h1>سوابق تغییرات (همه مخاطبین)</h1>
      <div class="card">
        <LogTable logs={props.logs} showContact={true} />
        <Pager page={props.page} hasNext={props.hasNext} base="/history" />
      </div>
    </Layout>
  );
}

export function FieldsPage(props: { user: User; defs: FieldDef[]; error?: string }) {
  return (
    <Layout title="فیلدهای اضافه" user={props.user}>
      <h1>فیلدهای اضافه</h1>
      <Errors errors={props.error ? [props.error] : []} />
      <div class="card">
        <p class="muted">هر اطلاعاتی که در فیلدهای اصلی نیست (ایمیل، شغل، ...) را اینجا تعریف کنید تا در فرم همه مخاطبین ظاهر شود.</p>
        {props.user.is_admin ? (
          <form method="post" action="/fields" class="row">
            <input name="name" placeholder="عنوان فیلد جدید" required style="max-width:300px" />
            <button>افزودن</button>
          </form>
        ) : (
          <p class="muted">فقط مدیر می‌تواند فیلد جدید تعریف کند.</p>
        )}
      </div>
      <div class="card">
        <table>
          <tbody>
            {props.defs.map((d) => (
              <tr>
                <td>{d.name}</td>
                <td>
                  {props.user.is_admin ? (
                    <form method="post" action={`/fields/${d.id}/rename`} class="row">
                      <input name="name" value={d.name} required style="max-width:220px" />
                      <button class="secondary">تغییر نام</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

export function UsersPage(props: { user: User; users: (User & { created_at: string })[]; error?: string; ok?: string }) {
  return (
    <Layout title="کاربران" user={props.user}>
      <h1>کاربران</h1>
      <Errors errors={props.error ? [props.error] : []} />
      {props.ok && <div class="okbox">{props.ok}</div>}
      <div class="card">
        <h2>کاربر جدید</h2>
        <form method="post" action="/users" class="row">
          <input name="username" placeholder="نام کاربری" class="ltr" required style="max-width:200px" />
          <input name="password" type="password" placeholder="رمز (حداقل ۱۰ کاراکتر)" class="ltr" minlength={10} required style="max-width:220px" />
          <label class="row" style="margin:0"><input type="checkbox" name="is_admin" value="1" style="width:auto" /> مدیر</label>
          <button>ساخت</button>
        </form>
      </div>
      <div class="card wrap">
        <table>
          <thead><tr><th>نام کاربری</th><th>نقش</th><th>تاریخ ساخت</th><th></th></tr></thead>
          <tbody>
            {props.users.map((u) => (
              <tr>
                <td class="ltr">{u.username}</td>
                <td>{u.is_admin ? "مدیر" : "کاربر"}</td>
                <td class="muted"><span class="dt">{formatJalali(u.created_at)}</span></td>
                <td>
                  {u.id !== props.user.id && (
                    <form method="post" action={`/users/${u.id}/delete`} onsubmit="return confirm('حذف شود؟')">
                      <button class="danger" style="padding:3px 10px">حذف</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

export function AccountPage(props: { user: User; error?: string; ok?: string }) {
  return (
    <Layout title="حساب کاربری" user={props.user}>
      <div class="card" style="max-width:420px">
        <h1>تغییر رمز عبور</h1>
        <Errors errors={props.error ? [props.error] : []} />
        {props.ok && <div class="okbox">{props.ok}</div>}
        <form method="post" action="/account">
          <label>رمز فعلی</label>
          <input name="current" type="password" class="ltr" required />
          <label style="margin-top:10px">رمز جدید (حداقل ۱۰ کاراکتر)</label>
          <input name="password" type="password" class="ltr" minlength={10} required />
          <p><button>ذخیره</button></p>
        </form>
      </div>
    </Layout>
  );
}
