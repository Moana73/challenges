import type { Env } from "./types";

export type AiMode = "split" | "breakdown";

// fp8-fast は Workers AI の中でも応答が速く、短い日本語の構造化タスクには十分な精度が出るため選定。
// （長文の高度な推論が必要なら 70b-instruct の非fp8版に上げる余地あり）
const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_ITEMS = 10;

const PROMPTS: Record<AiMode, string> = {
  split:
    "あなたは「挑戦したいことリスト」の整理アシスタントです。ユーザーが音声入力や走り書きで書いた" +
    "メモを、挑戦したいこと（チャレンジ）の単位に分割してください。各項目は日本語で、" +
    "名詞または「〜する」で終わる短い一文（25文字以内）にします。" +
    "メモに書かれていない項目は作らないでください。挨拶や説明は不要です。",
  breakdown:
    "あなたは目標分解アシスタントです。与えられた「挑戦したいこと」を、今日すぐ着手できる" +
    "具体的な最初の一歩に3〜5個分解してください。各ステップは日本語で、動詞で終わる短い一文" +
    "（30文字以内）にします。順番は実行順にしてください。",
};

const SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "string" } } },
  required: ["items"],
};

function clean(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const t = String(typeof item === "object" && item && "title" in item ? (item as { title: unknown }).title : item)
      .replace(/^[\s\-・*•\d.、)）]+/, "")
      .trim()
      .slice(0, 120);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** モデル出力の揺れ（オブジェクト / JSON文字列 / 箇条書き）を吸収する */
export function extractItems(raw: unknown): string[] {
  const r = (raw as { response?: unknown })?.response ?? raw;
  if (r && typeof r === "object") return clean((r as { items?: unknown }).items);
  if (typeof r === "string") {
    const m = r.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return clean(JSON.parse(m[0]).items);
      } catch {
        /* fallthrough */
      }
    }
    return clean(r.split(/\n+/));
  }
  return [];
}

/** テスト用の決定的な結果（AI_MOCK=true のときのみ・ネットワークやモデル課金なしでE2Eテスト可能にする） */
export function mockItems(text: string, mode: AiMode): string[] {
  if (mode === "breakdown") {
    const base = text.trim().slice(0, 30);
    return [`${base}について調べる`, `${base}の第一歩を決める`, `${base}を人に話してみる`];
  }
  return clean(text.split(/[\n、。,，]/));
}

export async function runAi(env: Env, text: string, mode: AiMode): Promise<string[]> {
  if (env.AI_MOCK === "true") return mockItems(text, mode);
  if (!env.AI) throw new Error("AI binding is not configured");
  const raw = await env.AI.run(env.AI_MODEL || DEFAULT_MODEL, {
    messages: [
      { role: "system", content: PROMPTS[mode] },
      { role: "user", content: text },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 500,
    temperature: 0.3,
  });
  return extractItems(raw);
}
