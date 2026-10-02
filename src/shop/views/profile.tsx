import { birthdayLabel } from "../../../lib/people";
import { useSite } from "../../render";
import type { User } from "../../session";
import { Avatar, IconButton, Layout, type Seo } from "./layout";

// Public profile at /u/<username>: the person's open wishlists and — if they allow it — the gifts
// they received, with the names of givers who chose to be shown.

export interface PublicPerson {
  id: number;
  name: string;
  username: string;
  avatar_key: string;
  birth_date: string;
  show_received: number;
  show_givers: number;
  show_birthday: number;
}

export interface PublicList {
  slug: string;
  title: string;
  description: string;
  occasion_date: string;
  items: number;
  fulfilled: number;
  cover: string;
}

export interface ReceivedGift {
  product_id: number;
  product_title: string;
  image_key: string;
  giver: string; // "" = not shown
}

const fa = (n: number) => n.toLocaleString("fa-IR");

export function PublicProfilePage(props: { viewer: User | null; person: PublicPerson; lists: PublicList[]; gifts: ReceivedGift[] | null; isMe: boolean }) {
  const site = useSite();
  const p = props.person;
  const url = `${site.origin}/u/${p.username}`;
  const birthday = p.show_birthday ? birthdayLabel(p.birth_date) : "";
  const seo: Seo = {
    description: `${p.name} در ${site.site_name}: ${fa(props.lists.length)} لیست آرزو${birthday ? ` · تولد ${birthday}` : ""}. یکی از آرزوهایش را انتخاب کن و برایش کادو بخر.`,
    image: p.avatar_key ? `/img/${p.avatar_key}` : undefined,
    type: "profile",
  };
  const header = (
    <header class="sticky top-0 z-40 bg-ink/80 backdrop-blur-md border-b border-card">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <IconButton icon="fa-chevron-right" label="بازگشت" attrs={{ "data-back": "/" }} />
        <a href="/" class="text-lg font-medium text-brand">{site.site_name}</a>
        <IconButton icon="fa-share-nodes" label="اشتراک" attrs={{ "data-share": url }} />
      </div>
    </header>
  );
  return (
    <Layout title={`${p.name} (@${p.username})`} user={props.viewer} nav={props.isMe ? "profile" : "home"} header={header} bare wide seo={seo}>
      <section class="px-6 py-8 text-center bg-gradient-to-b from-card to-ink rounded-b-[32px] mb-6">
        <div class="inline-block mb-4">
          <Avatar user={p} size="w-24 h-24" ring />
        </div>
        <h1 class="text-2xl font-bold mb-1">{p.name}</h1>
        <p class="text-sm text-muted ltr">@{p.username}</p>
        {birthday && <p class="text-sm text-fg mt-2">🎂 تولد: {birthday}</p>}
        <div class="flex justify-center gap-8 mt-5 text-center">
          <div>
            <div class="text-xl font-bold text-fg">{fa(props.lists.length)}</div>
            <div class="text-[11px] text-muted">لیست آرزو</div>
          </div>
          {props.gifts && (
            <div>
              <div class="text-xl font-bold text-brand">{fa(props.gifts.length)}</div>
              <div class="text-[11px] text-muted">کادوی گرفته</div>
            </div>
          )}
        </div>
        {props.isMe && (
          <p class="text-xs text-muted mt-5">
            این پروفایل عمومی شماست. <a href="/me/settings" class="text-brand">تنظیم نمایش کادوها و تولد</a>
          </p>
        )}
      </section>

      <section class="px-4 mb-10">
        <h2 class="text-lg font-bold mb-4 px-2">لیست‌های آرزو</h2>
        {props.lists.length === 0 ? (
          <p class="text-center text-muted text-sm py-6">فعلاً لیست بازی ندارد.</p>
        ) : (
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            {props.lists.map((l) => (
              <a href={`/w/${l.slug}`} class="group relative block bg-card rounded-3xl overflow-hidden aspect-[4/5]">
                {l.cover ? (
                  <img src={`/img/${l.cover}`} alt={l.title} loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div class="w-full h-full flex items-center justify-center text-5xl bg-plum">🎁</div>
                )}
                <div class="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent"></div>
                <div class="absolute inset-x-0 bottom-0 p-4">
                  <h3 class="text-sm font-bold text-fg truncate">{l.title}</h3>
                  <p class="text-[10px] text-muted">
                    {fa(l.items)} آرزو{l.fulfilled ? ` · ${fa(l.fulfilled)} برآورده شده` : ""}{l.occasion_date ? ` · ${l.occasion_date}` : ""}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {props.gifts && props.gifts.length > 0 && (
        <section class="px-4">
          <h2 class="text-lg font-bold mb-4 px-2">کادوهایی که گرفته</h2>
          <div class="masonry">
            {props.gifts.map((g) => (
              <a href={`/p/${g.product_id}`} class="relative block bg-card rounded-3xl overflow-hidden">
                {g.image_key ? (
                  <img src={`/img/${g.image_key}`} alt={g.product_title} loading="lazy" class="w-full h-auto block min-h-[140px] object-cover" />
                ) : (
                  <div class="w-full aspect-square flex items-center justify-center text-5xl bg-plum">🎁</div>
                )}
                <div class="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent"></div>
                <div class="absolute inset-x-0 bottom-0 p-4">
                  <h3 class="text-xs font-bold text-fg truncate">{g.product_title}</h3>
                  {g.giver && <p class="text-[10px] text-brand truncate">🎁 از طرف {g.giver}</p>}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </Layout>
  );
}
