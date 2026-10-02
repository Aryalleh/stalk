/** Tailwind build for the site (npm run css). Colors follow the designs in html/. */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17131a", // page background
        card: "#221c26", // surfaces
        plum: "#2a2230", // disabled surfaces
        fg: "#efe8f0", // text
        muted: "#a79daf", // secondary text
        pink: "#ff5c93", // accent
        ok: "#1b7f3b", // success
        tg: "#229ED9", // Telegram
        bale: "#2db57d", // Bale
      },
      fontFamily: { sans: ["Vazirmatn", "Tahoma", "sans-serif"] },
    },
  },
  plugins: [],
};
