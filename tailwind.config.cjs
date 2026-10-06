/** Tailwind build for the site (npm run css). Colors are CSS variables (src/styles/app.css), so the
 *  theme — and the brand color chosen in /admin/settings — is set in one place. */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: v("ink"), // page background
        card: v("card"), // surfaces
        plum: v("plum"), // disabled surfaces
        fg: v("fg"), // text
        muted: v("muted"), // secondary text
        brand: v("brand"), // accent (blue by default)
        ok: v("ok"), // success (lighter on the dark theme)
        tg: "#229ED9", // Telegram
        bale: "#2db57d", // Bale
      },
      fontFamily: { sans: ["Vazirmatn", "Tahoma", "sans-serif"] },
    },
  },
  plugins: [],
};
