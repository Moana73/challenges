import type { Env, User } from "./types";
import { base64urlDecode, cookie, json, parseCookies, randomToken, redirect, sha256 } from "./http";

const SESSION_COOKIE = "ch_sid";
const STATE_COOKIE = "ch_oauth_state";
const SESSION_TTL_SEC = 60 * 60 * 24 * 60; // 60日：毎回ログインさせず「開いたらすぐメモ」を守る
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export async function currentUser(req: Request, env: Env): Promise<User | null> {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(sid), Date.now())
    .first<User>();
  return row ?? null;
}

async function createSession(env: Env, user: User): Promise<string> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
  )
    .bind(user.id, user.email, user.name, user.picture, now)
    .run();
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), user.id, now + SESSION_TTL_SEC * 1000, now)
    .run();
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SEC });
}

export async function handleAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  // 1) Google の同意画面へ
  if (path === "/auth/google" && req.method === "GET") {
    if (!env.GOOGLE_CLIENT_ID) {
      return json({ error: "GOOGLE_CLIENT_ID が未設定です" }, 500);
    }
    const state = randomToken(24);
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${url.origin}/auth/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [
      cookie(STATE_COOKIE, state, { maxAge: 600, path: "/auth" }),
    ]);
  }

  // 2) Google からの戻り：state 検証 → code をトークンに交換 → ID トークンを検証 → セッション発行
  if (path === "/auth/callback" && req.method === "GET") {
    const clearState = cookie(STATE_COOKIE, "", { maxAge: 0, path: "/auth" });
    const fail = (reason: string) => redirect(`/?auth_error=${encodeURIComponent(reason)}`, [clearState]);

    const gErr = url.searchParams.get("error");
    if (gErr) return fail(`google_${gErr.replace(/[^a-z_]/gi, "").slice(0, 40)}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expected = parseCookies(req)[STATE_COOKIE];
    if (!code || !state || !expected || state !== expected) return fail("state");
    if (!env.GOOGLE_CLIENT_SECRET) return fail("secret");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID.trim(),
        // ダッシュボードへの貼り付け時に混入しがちな前後の空白・改行を除去
        client_secret: env.GOOGLE_CLIENT_SECRET.trim(),
        redirect_uri: `${url.origin}/auth/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("token_exchange_failed", tokenRes.status, body);
      return fail("token");
    }
    const token = (await tokenRes.json()) as { id_token?: string };
    if (!token.id_token) return fail("token");

    // ID トークンは Google のトークンエンドポイントから TLS で直接受け取ったものなので、
    // 署名検証は省略し、クレーム（iss / aud / exp / email_verified）を検証する。
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(base64urlDecode(token.id_token.split(".")[1] ?? ""));
    } catch {
      return fail("claims");
    }
    const ok =
      GOOGLE_ISSUERS.has(String(claims.iss)) &&
      claims.aud === env.GOOGLE_CLIENT_ID &&
      typeof claims.exp === "number" &&
      claims.exp * 1000 > Date.now() &&
      typeof claims.sub === "string" &&
      claims.email_verified === true;
    if (!ok) return fail("claims");

    // 自分専用：ALLOWED_EMAILS（カンマ区切り）が設定されていれば、そのアドレス以外はログインさせない
    const allowed = (env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(String(claims.email ?? "").toLowerCase())) {
      return redirect("/?auth_error=denied", [clearState]);
    }

    const sessionCookie = await createSession(env, {
      id: `google:${claims.sub}`,
      email: String(claims.email ?? ""),
      name: String(claims.name ?? ""),
      picture: String(claims.picture ?? ""),
    });
    return redirect("/", [sessionCookie, clearState]);
  }

  // 3) ログアウト
  if (path === "/auth/logout" && req.method === "POST") {
    const sid = parseCookies(req)[SESSION_COOKIE];
    if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(sid)).run();
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }) });
  }

  // 4) テスト専用ログイン：DEV_LOGIN=true かつ localhost のときだけ存在する
  if (path === "/auth/dev-login" && req.method === "GET" && env.DEV_LOGIN === "true" && isLocalhost(url)) {
    const u = (url.searchParams.get("u") || "tester").replace(/[^a-z0-9]/gi, "").slice(0, 20) || "tester";
    const sessionCookie = await createSession(env, {
      id: `dev:${u}`,
      email: `${u}@example.com`,
      name: u,
      picture: "",
    });
    return redirect("/", [sessionCookie]);
  }

  return json({ error: "not_found" }, 404);
}
