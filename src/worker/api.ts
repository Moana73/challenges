import type { Challenge, ChallengeStatus, Env, User } from "./types";
import { currentUser } from "./auth";
import { runAi, type AiMode } from "./ai";
import { json } from "./http";

const STATUSES: ReadonlySet<string> = new Set<ChallengeStatus>(["idea", "doing", "done"]);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

interface Row {
  id: string;
  title: string;
  note: string;
  status: ChallengeStatus;
  position: number;
  created_at: number;
  updated_at: number;
}

const toChallenge = (r: Row): Challenge => ({
  id: r.id,
  title: r.title,
  note: r.note,
  status: r.status,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isTs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e14;
}

export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  // 書き込み系はカスタムヘッダー必須（クロスサイトからは CORS プリフライトなしに付けられない＝CSRF対策）
  if (req.method !== "GET" && req.headers.get("x-ch") !== "1") {
    return json({ error: "forbidden" }, 403);
  }

  const user = await currentUser(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);

  const path = url.pathname;

  if (path === "/api/me" && req.method === "GET") return json({ user });

  if (path === "/api/challenges" && req.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, title, note, status, position, created_at, updated_at FROM challenges
       WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 2000`,
    )
      .bind(user.id)
      .all<Row>();
    return json({ challenges: results.map(toChallenge) });
  }

  const m = path.match(/^\/api\/challenges\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1] ?? "");
    if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
    if (req.method === "PUT") return putChallenge(req, env, user, id);
    if (req.method === "DELETE") return deleteChallenge(req, env, user, id);
  }

  if (path === "/api/ai/challenges" && req.method === "POST") {
    const body = await readJson(req);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const mode: AiMode = body?.mode === "breakdown" ? "breakdown" : "split";
    if (!text) return json({ error: "empty" }, 400);
    if (text.length > 2000) return json({ error: "too_long" }, 413);
    try {
      const items = await runAi(env, text, mode);
      return json({ items });
    } catch (e) {
      console.error("ai_failed", e);
      return json({ error: "ai_failed" }, 502);
    }
  }

  return json({ error: "not_found" }, 404);
}

async function putChallenge(req: Request, env: Env, user: User, id: string): Promise<Response> {
  const body = await readJson(req);
  if (!body) return json({ error: "bad_json" }, 400);
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 5000) : "";
  const status = String(body.status);
  const position = typeof body.position === "number" ? body.position : 0;
  if (!title || !STATUSES.has(status) || !isTs(body.createdAt) || !isTs(body.updatedAt)) {
    return json({ error: "invalid" }, 400);
  }
  // 他人の ID は上書きしない（WHERE user_id）＋ 新しい更新だけ反映（Last-Write-Wins、オフライン編集の衝突対策）
  const res = await env.DB.prepare(
    `INSERT INTO challenges (id, user_id, title, note, status, position, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, note = excluded.note, status = excluded.status,
       position = excluded.position, updated_at = excluded.updated_at, deleted_at = NULL
     WHERE challenges.user_id = excluded.user_id AND (
       excluded.updated_at > challenges.updated_at OR
       -- 同時刻の更新は許可するが、削除済みの行を同時刻の古い更新で復活させない
       (excluded.updated_at = challenges.updated_at AND challenges.deleted_at IS NULL)
     )`,
  )
    .bind(id, user.id, title, note, status, position, body.createdAt, body.updatedAt)
    .run();
  const applied = (res.meta?.changes ?? 0) > 0;
  if (!applied) {
    const owner = await env.DB.prepare("SELECT user_id FROM challenges WHERE id = ?").bind(id).first<{
      user_id: string;
    }>();
    if (owner && owner.user_id !== user.id) return json({ error: "forbidden" }, 403);
  }
  return json({ ok: true, applied });
}

async function deleteChallenge(req: Request, env: Env, user: User, id: string): Promise<Response> {
  const tsParam = Number(new URL(req.url).searchParams.get("ts"));
  const ts = isTs(tsParam) ? tsParam : Date.now();
  await env.DB.prepare(
    "UPDATE challenges SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at <= ?",
  )
    .bind(ts, ts, id, user.id, ts)
    .run();
  return json({ ok: true });
}
