import css from "./static/app.css";

// The compiled stylesheet (npm run css) is bundled into the Worker and served with a content hash
// in its URL, so browsers cache it forever and still pick up every new deploy.
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const CSS_URL = `/static/app.css?v=${hash(css)}`;
export const appCss = css;
