// Demo data for showing the site: shops, products with pictures, and a sample wishlist.
//
//   npm run demo:seed     # add (or refresh) the demo on the live site
//   npm run demo:clear    # remove it again
//   node scripts/demo.mjs seed --local   # same against `wrangler dev`
//
// Every demo row has an id from 9001 up, so clearing never touches real data. Pictures are
// generated SVGs uploaded to R2 under p/demo/, s/demo/ and a/demo/.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [mode = "seed", target = "--remote"] = process.argv.slice(2);
if (!["seed", "clear"].includes(mode) || !["--remote", "--local"].includes(target)) {
  console.error("usage: node scripts/demo.mjs seed|clear [--remote|--local]");
  process.exit(1);
}
const BUCKET = "gift-shop-images";
const CARD = "6037997599999993"; // passes the card check; demo only

// ---------- the data ----------

const users = [
  { id: 9001, phone: "09000009001", name: "فاطمه احمدی" },
  { id: 9002, phone: "09000009002", name: "رضا گلی" },
  { id: 9003, phone: "09000009003", name: "مهسا نوری" },
  { id: 9004, phone: "09000009004", name: "سارا محمدی", avatar: ["#ff8fb4", "#7c3aed", "👩🏻"] },
];

const shops = [
  {
    id: 9001, owner: 9001, name: "گالری لومینا", slug: "demo-lumina", city: "تهران", phone: "02188776655",
    description: "اکسسوری و دکوراسیون دست‌ساز؛ هر قطعه با عشق و برای کادو آماده می‌شود.",
    courier: 90000, post: 120000, instagram: "@lumina.gallery", telegram: "@lumina_gallery",
    logo: ["#ffd166", "#ef476f", "💎"], cover: ["#3a1c71", "#d76d77", "✨"],
  },
  {
    id: 9002, owner: 9002, name: "گل و پوشاک رز", slug: "demo-rose", city: "شیراز", phone: "07136271234",
    description: "دسته‌گل‌های تازه شیراز و پوشاک نخی راحت؛ ارسال با پیک در شیراز و پست به سراسر ایران.",
    courier: 70000, post: 110000, instagram: "@rose.shiraz",
    logo: ["#ff5c93", "#ffb3c6", "🌹"], cover: ["#ff9a9e", "#fecfef", "🌸"],
  },
  {
    id: 9003, owner: 9003, name: "کتاب‌سرای نور", slug: "demo-noor", city: "اصفهان", phone: "03132221111",
    description: "کتاب، لوازم تحریر و گجت‌های هوشمند برای کادوهای فکرشده.",
    courier: 60000, post: 100000, telegram: "@noor_books", website: "noor-books.example",
    logo: ["#06d6a0", "#118ab2", "📚"], cover: ["#0f2027", "#2c5364", "📖"],
  },
];

const tshirtGuide = JSON.stringify({
  columns: ["سایز", "دور سینه (cm)", "قد لباس (cm)"],
  rows: [["S", "96", "68"], ["M", "102", "71"], ["L", "108", "74"], ["XL", "114", "77"]],
});

// [shop, title, category, price, emoji, colors, height, description, features, packages?, sizeGuide?]
const products = [
  [9001, "ساعت مچی رزگلد الیت", "اکسسوری", 3450000, "⌚", ["#f6d365", "#fda085"], 900, "ساعت مچی زنانه با بند استیل رزگلد و صفحه صدفی؛ مقاوم در برابر آب.", ["بند استیل ضدحساسیت", "ضد آب تا ۳ اتمسفر", "جعبه چوبی کادویی"], [["جعبه کادو با روبان", 0], ["جعبه لوکس مخمل", 150000]]],
  [9001, "گردنبند نقره ماه و ستاره", "اکسسوری", 1280000, "🌙", ["#a18cd1", "#fbc2eb"], 700, "گردنبند نقره ۹۲۵ با آویز ماه و ستاره، زنجیر ۴۵ سانتی.", ["نقره ۹۲۵ عیار", "قابل حک نام", "ضمانت رنگ"], [["کیسه مخمل", 0], ["جعبه چرمی", 90000]]],
  [9001, "آباژور چوبی دست‌ساز", "دکوراسیون", 1200000, "🪔", ["#f093fb", "#f5576c"], 1000, "آباژور رومیزی با پایه چوب گردو و نور گرم؛ مناسب اتاق خواب و میز کار.", ["چوب گردو طبیعی", "لامپ LED کم‌مصرف", "کلید لمسی"]],
  [9001, "شمع معطر آرامش", "دکوراسیون", 320000, "🕯️", ["#ffecd2", "#fcb69f"], 650, "شمع سویا با رایحه وانیل و چوب صندل در لیوان شیشه‌ای.", ["موم سویا طبیعی", "۴۰ ساعت سوختن", "لیوان قابل استفاده دوباره"], [["بسته‌بندی ساده", 0], ["پک کادویی با کارت", 40000]]],
  [9001, "گلدان سرامیکی مدرن", "دکوراسیون", 850000, "🏺", ["#c3cfe2", "#f5f7fa"], 850, "گلدان سرامیکی لعاب مات با طراحی مینیمال.", ["سرامیک دست‌ساز", "مناسب گل خشک و تازه"]],
  [9001, "پک مراقبت پوست ارگانیک", "تولد", 890000, "🧴", ["#d4fc79", "#96e6a1"], 600, "پک سه‌تایی سرم، کرم و ماسک با ترکیبات گیاهی.", ["بدون پارابن", "مناسب انواع پوست", "تاریخ تولید جدید"], [["جعبه کادو", 0]]],
  [9002, "دسته‌گل رز قرمز", "گل و گیاه", 850000, "🌹", ["#ff5858", "#f857a6"], 950, "۲۱ شاخه رز قرمز تازه با کاغذ کرافت و روبان؛ ارسال همان روز در شیراز.", ["گل تازه روز", "ماندگاری ۷ روز", "کارت پیام رایگان"], [["کاغذ کرافت", 0], ["باکس لوکس", 200000]]],
  [9002, "گیاه آپارتمانی زاموفیلیا", "گل و گیاه", 540000, "🪴", ["#56ab2f", "#a8e063"], 800, "زاموفیلیا با گلدان سفید؛ کم‌توقع و مقاوم، مناسب هدیه به خانه نو.", ["نیاز کم به آب", "گلدان سرامیکی", "راهنمای نگهداری"]],
  [9002, "تی‌شرت نخی اورسایز", "پوشاک", 450000, "👕", ["#89f7fe", "#66a6ff"], 750, "تی‌شرت نخ پنبه ۱۰۰٪ با یقه گرد؛ در چهار رنگ.", ["نخ پنبه ۱۰۰٪", "قابل شستشو در ماشین", "دوخت ایرانی"], null, tshirtGuide],
  [9002, "هودی گرم زمستانه", "پوشاک", 980000, "🧥", ["#fbc2eb", "#a6c1ee"], 900, "هودی دورس داخل کرکی با کلاه و جیب کانگورویی.", ["داخل کرکی", "کلاه دوجداره", "رنگ ثابت"], [["کیسه پارچه‌ای", 0]], tshirtGuide],
  [9002, "باکس گل و شکلات تولد", "تولد", 1350000, "🎂", ["#f6d365", "#ff5c93"], 700, "باکس گل رز صورتی با شکلات دست‌ساز و بادکنک «تولدت مبارک».", ["گل تازه", "شکلات دست‌ساز", "بادکنک فویلی"], [["باکس استاندارد", 0], ["باکس بزرگ با کیک", 450000]]],
  [9003, "اسپیکر بلوتوثی پرتابل", "تکنولوژی", 1450000, "🔊", ["#434343", "#000000"], 650, "اسپیکر ضدآب با ۱۲ ساعت شارژدهی و صدای استریو.", ["ضد آب IPX6", "۱۲ ساعت پخش", "بلوتوث ۵٫۳"]],
  [9003, "هدفون نویز کنسلینگ", "تکنولوژی", 9800000, "🎧", ["#30cfd0", "#330867"], 1000, "هدفون بی‌سیم با حذف نویز فعال و ۳۰ ساعت شارژدهی.", ["حذف نویز فعال", "۳۰ ساعت باتری", "شارژ سریع"]],
  [9003, "کیندل کتاب‌خوان", "تکنولوژی", 7200000, "📱", ["#e0c3fc", "#8ec5fc"], 800, "کتاب‌خوان با صفحه جوهر الکترونیک و نور قابل تنظیم.", ["صفحه ضد بازتاب", "چند هفته شارژ", "حافظه ۱۶ گیگ"]],
  [9003, "مجموعه کتاب شازده کوچولو", "کتاب", 380000, "📕", ["#ffecd2", "#fcb69f"], 900, "نسخه مصور و جلد سخت شازده کوچولو، ترجمه فارسی.", ["جلد سخت", "تصویرگری رنگی", "کاغذ بالک"], [["کادو با کاغذ هدیه", 30000]]],
  [9003, "دفترچه یادداشت هنری", "کتاب", 185000, "📓", ["#fddb92", "#d1fdff"], 600, "دفترچه نقطه‌چین با جلد پارچه‌ای و ۲۰۰ برگ کاغذ ۱۰۰ گرمی.", ["۲۰۰ برگ", "کاغذ ۱۰۰ گرمی", "بندینک کشی"]],
  [9003, "ست خودکار و روان‌نویس", "تولد", 420000, "🖋️", ["#cfd9df", "#e2ebf0"], 700, "ست فلزی خودکار و روان‌نویس در جعبه چرمی؛ قابل حک نام.", ["بدنه فلزی", "حک نام رایگان", "جعبه چرمی"]],
];

const wishlist = {
  id: 9001, user: 9004, slug: "demo-sara", title: "تولد سارا 🎂", occasion: "۲۵ خرداد", city: "تهران",
  description: "این‌ها چیزهایی هستند که برای تولدم خیلی خوشحالم می‌کنند! ✨",
  // [product index, quantity, size, bought]
  items: [[0, 1, "", 1], [12, 1, "", 0], [8, 2, "M", 1], [3, 2, "", 0], [6, 1, "", 0], [14, 1, "", 1]],
};

// ---------- pictures ----------

function svg([c1, c2, emoji], w, h, round = false) {
  const size = Math.round(Math.min(w, h) * 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="${w}" height="${h}" ${round ? `rx="${w / 2}"` : ""} fill="url(#g)"/>
<circle cx="${w * 0.82}" cy="${h * 0.16}" r="${w * 0.22}" fill="#fff" opacity=".12"/><circle cx="${w * 0.12}" cy="${h * 0.86}" r="${w * 0.3}" fill="#fff" opacity=".08"/>
<text x="50%" y="${round ? "54%" : "46%"}" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${emoji}</text></svg>`;
}

const images = []; // [key, svg]
const productKeys = products.map((p, i) => {
  const [, , , , emoji, colors, h] = p;
  const main = `p/demo/${9001 + i}-1.svg`;
  const alt = `p/demo/${9001 + i}-2.svg`;
  images.push([main, svg([colors[0], colors[1], emoji], 600, h)], [alt, svg([colors[1], colors[0], emoji], 600, 600)]);
  return [main, alt];
});
for (const s of shops) {
  images.push([`s/demo/${s.slug}-logo.svg`, svg(s.logo, 300, 300)], [`s/demo/${s.slug}-cover.svg`, svg(s.cover, 1200, 500)]);
}
for (const u of users.filter((u) => u.avatar)) images.push([`a/demo/${u.id}.svg`, svg(u.avatar, 300, 300, true)]);

// ---------- SQL ----------

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

const clearSql = [
  "DELETE FROM orders WHERE id >= 9001 AND id < 10000;",
  "DELETE FROM wishlist_items WHERE id >= 9001 AND id < 10000;",
  "DELETE FROM wishlists WHERE id >= 9001 AND id < 10000;",
  "DELETE FROM product_packages WHERE id >= 9001 AND id < 10000;",
  "DELETE FROM product_images WHERE id >= 9001 AND id < 10000;",
  "DELETE FROM products WHERE id >= 9001 AND id < 10000;",
  "DELETE FROM shops WHERE id >= 9001 AND id < 10000;",
  "DELETE FROM users WHERE id >= 9001 AND id < 10000;",
  "UPDATE settings SET value = '' WHERE key = 'featured_shop_id' AND value = '9001';",
];

function seedSql() {
  const out = [...clearSql];
  for (const u of users) {
    out.push(`INSERT INTO users (id, phone, name, password_hash, created_at, avatar_key) VALUES (${u.id}, ${q(u.phone)}, ${q(u.name)}, '!', ${q(ago(9000))}, ${q(u.avatar ? `a/demo/${u.id}.svg` : "")});`);
  }
  for (const s of shops) {
    out.push(
      `INSERT INTO shops (id, owner_id, name, slug, description, phone, status, card_number, card_holder, city, courier_enabled, courier_fee, post_enabled, post_fee, instagram, telegram, bale, website, logo_key, cover_key, created_at) VALUES (` +
        [s.id, s.owner, s.name, s.slug, s.description, s.phone, "approved", CARD, users.find((u) => u.id === s.owner).name, s.city, 1, s.courier, 1, s.post,
          s.instagram ?? "", s.telegram ?? "", "", s.website ?? "", `s/demo/${s.slug}-logo.svg`, `s/demo/${s.slug}-cover.svg`, ago(8000)].map(q).join(", ") + ");",
    );
  }
  let imageId = 9001;
  let packageId = 9001;
  products.forEach(([shop, title, category, price, , , , description, features, packages, guide], i) => {
    const id = 9001 + i;
    const t = ago(products.length - i); // newest last in the list = first in the feed
    out.push(
      `INSERT INTO products (id, shop_id, title, description, price, image_key, is_active, created_at, updated_at, video_url, size_guide, size_guide_image, category, features) VALUES (` +
        [id, shop, title, description, price, productKeys[i][0], 1, t, t, "", guide ?? "", "", category, features.join("\n")].map(q).join(", ") + ");",
    );
    productKeys[i].forEach((key, n) => out.push(`INSERT INTO product_images (id, product_id, image_key, sort) VALUES (${imageId++}, ${id}, ${q(key)}, ${n});`));
    (packages ?? []).forEach(([name, p], n) => out.push(`INSERT INTO product_packages (id, product_id, name, price, sort) VALUES (${packageId++}, ${id}, ${q(name)}, ${p}, ${n});`));
  });
  const w = wishlist;
  out.push(
    `INSERT INTO wishlists (id, user_id, slug, title, description, occasion_date, recipient_name, recipient_phone, address, postal_code, city, is_open, created_at) VALUES (` +
      [w.id, w.user, w.slug, w.title, w.description, w.occasion, "سارا محمدی", "09000009004", "تهران، نمونه (داده دمو)", "1234567890", w.city, 1, ago(5000)].map(q).join(", ") + ");",
  );
  let orderId = 9001;
  w.items.forEach(([pi, qty, size, bought], n) => {
    const itemId = 9001 + n;
    const [shop, title, , price] = products[pi];
    out.push(`INSERT INTO wishlist_items (id, wishlist_id, product_id, quantity, note, size, created_at) VALUES (${itemId}, ${w.id}, ${9001 + pi}, ${qty}, '', ${q(size)}, ${q(ago(4000 - n))});`);
    for (let k = 0; k < bought; k++) {
      const t = ago(1000 + n * 60);
      out.push(
        `INSERT INTO orders (id, token, item_id, wishlist_id, product_id, shop_id, product_title, amount, item_price, giver_name, giver_phone, gift_message, status, expires_at, pay_card_number, size, delivery_method, delivery_fee, ship_city, reported_at, created_at, paid_at, shipped_at) VALUES (` +
          [orderId, `demo-order-${orderId}`, itemId, w.id, 9001 + pi, shop, title, price, price, "نیکان", "09000009099", "تولدت مبارک سارا جان! 🎉", "delivered", t, CARD, size, "post", 0, w.city, t, t, t, t].map(q).join(", ") + ");",
      );
      orderId++;
    }
  });
  out.push("INSERT INTO settings (key, value) VALUES ('featured_shop_id', '9001') ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE settings.value = '';");
  return out;
}

// ---------- run ----------

const dir = mkdtempSync(join(tmpdir(), "demo-"));
const wrangler = (args) => execFileSync("npx", ["wrangler", ...args, target], { stdio: "inherit" });

if (mode === "seed") {
  console.log(`Uploading ${images.length} demo pictures to R2 (${target.slice(2)})…`);
  for (const [key, body] of images) {
    const file = join(dir, key.replace(/\//g, "_"));
    writeFileSync(file, body);
    execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, `--file=${file}`, "--content-type=image/svg+xml", target], { stdio: "ignore" });
    process.stdout.write(".");
  }
  console.log("\nWriting demo rows to D1…");
}
const sqlFile = join(dir, `${mode}.sql`);
writeFileSync(sqlFile, (mode === "seed" ? seedSql() : clearSql).join("\n") + "\n");
wrangler(["d1", "execute", "app", `--file=${sqlFile}`, "--yes"]);
if (mode === "clear") {
  console.log("Removing demo pictures from R2…");
  for (const [key] of images) {
    try {
      execFileSync("npx", ["wrangler", "r2", "object", "delete", `${BUCKET}/${key}`, target], { stdio: "ignore" });
    } catch {
      // already gone
    }
    process.stdout.write(".");
  }
  console.log();
}
console.log(mode === "seed" ? "Demo ready: open the site; sample wishlist at /w/demo-sara" : "Demo data removed.");
