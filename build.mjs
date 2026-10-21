// フロントエンドのビルドスクリプト。
// public/ 配下の HTML・CSS・manifest・Service Worker・アイコンはそのまま配信されるので、
// ここでは src/client の TypeScript を 1 本の public/app.js にバンドルするだけでよい。
// (Vite のようなフルバンドラーは使わず esbuild 単体にしているのは、
//  単一画面アプリでコード分割の恩恵が薄く、ビルドが速く・依存が少ないほうが
//  「開いた瞬間に使える」軽さと相性が良いため)
import { build } from "esbuild";

await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true,
  outfile: "public/app.js",
  format: "esm",
  target: ["ios17", "safari17", "chrome120"],
  minify: true,
  sourcemap: true,
  legalComments: "none",
});

console.log("build: public/app.js を生成しました");
