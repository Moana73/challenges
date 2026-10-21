# Challenges

挑戦したいことをメモして、ステータス（やりたい → 挑戦中 → 達成）をフリックで管理する、本人専用の iOS向け PWA。

## 使い方（本人向け）

1. `https://challenges.<あなたのサブドメイン>.workers.dev` を Safari で開く
2. Googleでログイン（登録済みのGoogleアカウントのみ）
3. 共有ボタン →「ホーム画面に追加」でアイコン化

## 技術構成と選定理由

| 領域 | 採用技術 | 理由 |
| --- | --- | --- |
| フロントエンド | Vanilla TypeScript + esbuild（フレームワーク/ビルダーなし） | 「開いた瞬間にメモできる」が最優先要件。React等のフレームワークはランタイムの初期化・ハイドレーションでわずかでも遅延が生まれる。画面がほぼ1枚（リスト＋入力＋詳細シート）の個人アプリにはフレームワークの恩恵（状態管理の複雑さの吸収、大規模チーム開発でのコンポーネント分割）が薄く、依存ゼロで最小のJSを配信できるVanilla構成を選んだ。 |
| オフライン/即時入力 | IndexedDB（自前の薄いラッパー、約40行） | 新規メモは必ずローカルに即書き込み→即描画してからバックグラウンドでサーバーに送る楽観的UIにしている。ネットワークが遅い/圏外でも「開いた瞬間メモできる」を満たすための要。idb-keyval 等も検討したが、使う操作が「全件取得・1件upsert・1件削除」のみで依存を追加するほどの価値がなかった。 |
| PWA化 | 手書きの Service Worker + Web App Manifest（Workboxなし） | アプリシェル（HTML/CSS/JS/アイコン）はキャッシュ優先、`/api/*`と`/auth/*`は常にネットワークという2パターンの戦略で十分なため、Workboxのような重いツールチェーンは不要と判断。 |
| バックエンド | Cloudflare Workers（単一Worker、静的アセット配信とAPIを同居） | コールドスタートがほぼ無く世界中のエッジで実行される。個人利用・無料枠で十分な規模。既存の自作PWA（tasks）と同じ構成実績があり、運用の見通しが立てやすい。 |
| データベース | Cloudflare D1（SQLite） | リレーショナルなクエリ（ユーザー×チャレンジ）が自然に書け、Workersからのバインディングも軽量。KVでは「ユーザーごとの一覧を新しい順に取得」のようなクエリがやりづらい。 |
| AI機能 | Workers AI（`@cf/meta/llama-3.3-70b-instruct-fp8-fast`） | ①長文メモを複数のチャレンジに分割、②1件のチャレンジを最初の一歩に分解、の2機能に使用。fp8-fastモデルは応答が速く、短い日本語の構造化出力（JSON Schema強制）には十分な精度。外部LLM APIを使わずCloudflare内で完結させることで鍵管理・課金経路を一本化した。 |
| 認証 | Google OAuth 2.0（自前実装、ライブラリなし）＋ `ALLOWED_EMAILS` で本人のみに制限 | Workers（V8 isolate）上で動く汎用authライブラリ（Auth.js等）は相性問題や過剰機能が出やすく、フローも複雑ではないため手書きの方が軽量・把握しやすいと判断。本人専用アプリのため許可リストで他者のログインを遮断している。 |
| デプロイ | Cloudflare Workers Builds（GitHub連携、push時に自動ビルド＆デプロイ） | 本セッションの実行環境からはローカルで`wrangler deploy`するためのパッケージ取得（npm registryへの接続）ができない制約があったため、GitHubにpushすればCloudflare側のビルド環境が`npm install`〜`wrangler deploy`まで行うGit連携方式を採用。結果として、今後の修正も「pushするだけ」で本番反映される継続的デプロイの形になっている。 |

## ディレクトリ構成

```
src/worker/   … Cloudflare Worker（API・認証・Workers AI呼び出し）
src/client/   … フロントエンド TypeScript（esbuildで public/app.js にバンドル）
public/       … 配信される静的アセット一式（index.html / style.css / manifest / sw.js / icons）
db/schema.sql … D1のテーブル定義（本番へは適用済み）
scripts/      … アイコン生成スクリプト（開発時のみ使用）
```

## ローカル開発

```bash
npm install
npm run dev     # wrangler dev（要 Cloudflareログイン）
npm run build   # public/app.js を生成するだけ
npm run deploy  # ビルドしてデプロイ（通常はGit push経由の自動デプロイを使うため手動実行は不要）
```

## 環境変数 / シークレット（Cloudflareダッシュボード側で設定）

| 名前 | 種別 | 用途 |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Variable | Google OAuthクライアントID |
| `GOOGLE_CLIENT_SECRET` | Secret | Google OAuthクライアントシークレット |
| `ALLOWED_EMAILS` | Variable | ログインを許可するメールアドレス（カンマ区切り） |

リポジトリには含めていません（Publicリポジトリのため）。
