// モーション基盤。
// - Web Animations API（element.animate）で、状態を汚さない一時的なアニメーションを再生する。
//   すべてのキーフレームは「最後に要素本来のスタイルへ戻る」形にしているので、
//   reduce-motion 時に再生を丸ごと省略しても見た目の最終状態は変わらない。
// - バネ（spring）は物理シミュレーションから CSS の linear() イージングを生成する。
//   linear() 非対応の環境（iOS 17.1 以前など）では近い cubic-bezier にフォールバック。

const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reduced = (): boolean => reduceMq.matches;

const supportsLinear = (() => {
  try {
    return CSS.supports("animation-timing-function", "linear(0, 0.5, 1)");
  } catch {
    return false;
  }
})();

export interface Spring {
  easing: string;
  duration: number;
}

/** 減衰バネを数値積分して linear() 形式のイージングにする */
function makeSpring(stiffness: number, damping: number, fallback: string): Spring {
  const mass = 1;
  const dt = 1 / 120;
  let x = 0;
  let v = 0;
  const pts: number[] = [];
  let t = 0;
  for (; t < 3; t += dt) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    pts.push(x);
    if (t > 0.1 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const duration = Math.round(t * 1000);
  if (!supportsLinear) return { easing: fallback, duration: Math.min(duration, 600) };
  // 点数を間引いて CSS の文字列長を抑える（約60点で十分なめらか）
  const step = Math.max(1, Math.floor(pts.length / 60));
  const sampled = pts.filter((_, i) => i % step === 0);
  sampled[0] = 0;
  sampled.push(1);
  return { easing: `linear(${sampled.map((p) => p.toFixed(4)).join(", ")})`, duration };
}

// 用途別のバネ。bouncy=目に見えて弾む / soft=控えめな行き過ぎ / snappy=速く収まる
export const SPRING = {
  bouncy: makeSpring(320, 18, "cubic-bezier(0.34, 1.56, 0.64, 1)"),
  soft: makeSpring(220, 26, "cubic-bezier(0.22, 1.2, 0.36, 1)"),
  snappy: makeSpring(500, 34, "cubic-bezier(0.2, 1, 0.3, 1)"),
};
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)";

export function play(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions & { spring?: Spring } = {},
): Animation | null {
  if (!el || reduced() || typeof (el as HTMLElement).animate !== "function") return null;
  const { spring, ...rest } = opts;
  return (el as HTMLElement).animate(keyframes, {
    duration: spring?.duration ?? 320,
    easing: spring?.easing ?? EASE_OUT,
    fill: "none",
    ...rest,
  });
}

// ---------------------------------------------------------------------------
// FLIP：DOM 変更前後の位置差を transform で補間し、並び替え・追加・削除で
//       周りのカードが瞬間移動せず「するっと」詰まるようにする
// ---------------------------------------------------------------------------
export function measure(els: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> {
  const m = new Map<HTMLElement, DOMRect>();
  for (const el of els) if (el.isConnected) m.set(el, el.getBoundingClientRect());
  return m;
}

export function flip(before: Map<HTMLElement, DOMRect>, skip: Set<HTMLElement> = new Set()) {
  if (reduced()) return;
  for (const [el, prev] of before) {
    if (!el.isConnected || skip.has(el)) continue;
    const now = el.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    play(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { spring: SPRING.soft });
  }
}

// ---------------------------------------------------------------------------
// タップの波紋（iOS のハイライトの代わりに、押した位置から広がる柔らかい光）
// ---------------------------------------------------------------------------
const RIPPLE_HOSTS =
  ".icon-btn, .segmented button, .sheet-status-row button, .sheet-ai-btn, .google-btn, .card, .delete-btn, .close-btn, .toast button";

export function installRipples() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (reduced()) return;
      const host = (e.target as HTMLElement | null)?.closest<HTMLElement>(RIPPLE_HOSTS);
      if (!host || (host as HTMLButtonElement).disabled) return;
      const r = host.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const dot = document.createElement("span");
      dot.className = "ripple";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - r.left - size / 2}px`;
      dot.style.top = `${e.clientY - r.top - size / 2}px`;
      host.appendChild(dot);
      const a = dot.animate(
        [
          { transform: "scale(0)", opacity: 0.22 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: 650, easing: EASE_OUT },
      );
      a.onfinish = () => dot.remove();
    },
    { passive: true },
  );
}

// ---------------------------------------------------------------------------
// 紙吹雪（「達成」にしたときのご褒美演出）
// ---------------------------------------------------------------------------
const CONFETTI = ["#30b350", "#0a84ff", "#ff9500", "#ff2d55", "#af52de", "#ffcc00", "#5ac8fa"];

export function burst(x: number, y: number, opts: { count?: number; spread?: number; colors?: string[] } = {}) {
  if (reduced()) return;
  const count = opts.count ?? 26;
  const spread = opts.spread ?? 110;
  const colors = opts.colors ?? CONFETTI;
  const layer = document.createElement("div");
  layer.className = "fx-layer";
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  document.body.appendChild(layer);
  let done = 0;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = i % 3 === 0 ? "fx-piece round" : "fx-piece";
    p.style.background = colors[i % colors.length]!;
    layer.appendChild(p);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = spread * (0.45 + Math.random() * 0.65);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 30;
    const rot = (Math.random() - 0.5) * 720;
    const a = p.animate(
      [
        { transform: "translate(0,0) rotate(0deg) scale(0.4)", opacity: 1 },
        { transform: `translate(${dx * 0.85}px, ${dy * 0.85}px) rotate(${rot * 0.6}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy + 70}px) rotate(${rot}deg) scale(0.8)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 500, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", delay: Math.random() * 60 },
    );
    a.onfinish = () => {
      if (++done === count) layer.remove();
    };
  }
}

/** 色付きの輪が中心から広がって消える（ステータスが変わった瞬間の「パルス」） */
export function pulseRing(target: HTMLElement, color: string) {
  if (reduced()) return;
  const r = target.getBoundingClientRect();
  const ring = document.createElement("div");
  ring.className = "fx-ring";
  ring.style.left = `${r.left + r.width / 2}px`;
  ring.style.top = `${r.top + r.height / 2}px`;
  ring.style.borderColor = color;
  document.body.appendChild(ring);
  const a = ring.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0.9 },
      { transform: "translate(-50%, -50%) scale(3.4)", opacity: 0 },
    ],
    { duration: 700, easing: EASE_OUT },
  );
  a.onfinish = () => ring.remove();
}

/** テキストエリアへ一文字ずつ流し込む（AI の提案を「書いている」ように見せる） */
export function typeInto(field: HTMLTextAreaElement, text: string, onDone: () => void) {
  if (reduced()) {
    field.value += text;
    onDone();
    return;
  }
  const chars = [...text];
  const perTick = Math.max(1, Math.ceil(chars.length / 45)); // 長くても約0.75秒で書き終える
  let i = 0;
  const tick = () => {
    field.value += chars.slice(i, i + perTick).join("");
    i += perTick;
    field.scrollTop = field.scrollHeight;
    if (i < chars.length) window.setTimeout(tick, 16);
    else onDone();
  };
  tick();
}
