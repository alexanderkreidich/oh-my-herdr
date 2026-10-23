# Project artwork

The icon is a pixel-art T-Rex in the manner of Chrome's offline game, drawn from the pixel map in
[`scripts/generate-brand.ts`](../../scripts/generate-brand.ts): ink `#535353` on paper `#f7f7f7`,
each art pixel a whole number of image pixels so every size stays sharp.

Run `bun scripts/generate-brand.ts` after changing the art. It writes the app icons (plain and
maskable, the maskable ones inside the 80% safe circle), the white-on-transparent notification
badge Android draws from alpha alone, the Apple touch icon, `favicon.png`, `favicon.ico` and the
1280 × 640 social preview with the pixel word "t-rex". New icons need a new `?v=` query and
`CACHE_NAME` (`src/conventions.test.ts` says which).

GitHub's repository preview is a separate setting: open
[repository settings](https://github.com/alexanderkreidich/t-rex/settings), then **Social preview →
Edit → Upload an image** and select `public/social-preview.png`.
