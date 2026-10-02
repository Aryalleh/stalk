declare module "*.sql" {
  const sql: string;
  export default sql;
}

declare module "*.css" {
  const css: string;
  export default css;
}

declare module "*.svg" {
  const svg: string;
  export default svg;
}

declare module "*.png" {
  const png: ArrayBuffer;
  export default png;
}

declare module "*.woff2" {
  const font: ArrayBuffer;
  export default font;
}
