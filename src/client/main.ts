import { api, AuthRequiredError } from "./api";
import { attachDrag } from "./gestures";
import { GOOGLE_G_DATA_URI, ICON_EMPTY, ICON_FLAG, ICON_SEND, ICON_SPARKLE } from "./icons";
import { burst, EASE_IN, EASE_OUT, flip, installRipples, measure, play, pulseRing, reduced, SPRING, typeInto } from "./motion";
import { store } from "./state";
import type { Challenge, ChallengeStatus } from "./types";
import { STATUS_LABEL } from "./types";

const STATUS_COLOR: Record<ChallengeStatus, string> = {
  idea: "#8e8e93",
  doing: "#ff9500",
  done: "#30b350",
};

type Filter = "all" | ChallengeStatus;
const FILTERS: Filter[] = ["all", "idea", "doing", "done"];
const FILTER_LABEL: Record<Filter, string> = { all: "すべて", ...STATUS_LABEL };

let filter: Filter = "all";
/** 直前のタブ切替の方向（-1=左へ / 1=右へ）。カードの出入りをその方向に流すために使う */
let filterDir = 0;
/** 直前にフリックしたカードと方向。フィルタ外へ出ていくときにフリック方向へ飛ばす */
let lastSwipe: { id: string; dir: 1 | -1 } | null = null;
/** 初回描画のカードは上から順番に（スタッガーで）出す */
let firstPaint = true;
let openSheetId: string | null = null;
let pendingNoteFlush: number | null = null;

const bootSkeleton = document.getElementById("boot-skeleton")!;
const app = document.getElementById("app")!;

// ---------------------------------------------------------------------------
// ブート：認証確認とローカルデータの読み出しを並行で行い、できるだけ早く
// 「スケルトン → 本体」へ切り替える。オフライン時はローカルキャッシュのみで起動する。
// ---------------------------------------------------------------------------
async function boot() {
  installRipples();
  const hydratePromise = store.hydrate();
  try {
    const { user } = await api.me();
    await hydratePromise;
    showShell(user.picture, user.name);
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      showLogin();
      return;
    }
    // ネットワークエラー：オフライン起動としてローカルキャッシュで継続
    await hydratePromise;
    if (store.challenges.length > 0 || navigator.serviceWorker) {
      showShell(null, null);
    } else {
      showLogin("offline");
    }
  }
}

function hideBootSkeleton() {
  bootSkeleton.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// ログイン画面
// ---------------------------------------------------------------------------
function showLogin(errorCode?: string | null) {
  hideBootSkeleton();
  const params = new URLSearchParams(location.search);
  const err = errorCode ?? params.get("auth_error");
  app.setAttribute("aria-hidden", "false");
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-card glass-strong">
        <div class="login-mark rise" style="--d:120ms">${ICON_FLAG}</div>
        <h1 class="rise" style="--d:200ms">Challenges</h1>
        <p class="rise" style="--d:260ms">Googleアカウントでログインしてください</p>
        <a class="google-btn rise" style="--d:340ms" href="/auth/google" id="google-btn">
          <img src="${GOOGLE_G_DATA_URI}" alt="" width="18" height="18" />
          Googleでログイン
        </a>
        ${err ? `<div class="login-error rise" style="--d:460ms">${loginErrorText(err)}</div>` : ""}
      </div>
    </div>
  `;
  // ボタンを押したらカードが沈み込むように退場してから Google へ遷移する
  const btn = document.getElementById("google-btn") as HTMLAnchorElement;
  btn.addEventListener("click", (e) => {
    if (reduced()) return;
    e.preventDefault();
    const card = app.querySelector(".login-card");
    const a = play(
      card,
      [
        { transform: "none", opacity: 1, filter: "blur(0px)" },
        { transform: "translateY(10px) scale(0.94)", opacity: 0, filter: "blur(8px)" },
      ],
      { duration: 260, easing: EASE_IN, fill: "forwards" },
    );
    const go = () => (location.href = btn.href);
    if (a) a.onfinish = go;
    else go();
  });
}

function loginErrorText(code: string): string {
  if (code === "denied") return "このアプリは登録済みのアカウント専用です。";
  if (code === "offline") return "オフラインのため読み込めませんでした。接続を確認してください。";
  return "ログインに失敗しました。もう一度お試しください。";
}

// ---------------------------------------------------------------------------
// アプリ本体シェル
// ---------------------------------------------------------------------------
function showShell(avatarUrl: string | null, _name: string | null) {
  app.setAttribute("aria-hidden", "false");
  app.innerHTML = `
    <div class="topbar">
      <div class="brand-row">
        <div class="brand">Challenges</div>
        <button class="avatar-btn" id="avatar-btn" aria-label="ログアウト">
          ${avatarUrl ? `<img src="${avatarUrl}" alt="" />` : `<div style="width:100%;height:100%;background:#d8dae0"></div>`}
        </button>
      </div>
      <form class="capture-form glass-strong" id="capture-form">
        <textarea
          id="capture-input"
          rows="1"
          placeholder="いま挑戦したいことは？"
          maxlength="2000"
          autocomplete="off"
        ></textarea>
        <div class="capture-actions">
          <button type="button" class="icon-btn" id="ai-split-btn" aria-label="AIで分割して追加" title="AIで分割して追加">
            ${ICON_SPARKLE}
          </button>
          <button type="submit" class="icon-btn primary" id="send-btn" aria-label="追加" disabled>
            ${ICON_SEND}
          </button>
        </div>
      </form>
      <div class="segmented glass" id="segmented">
        <div class="thumb"></div>
        ${FILTERS.map(
          (f) => `<button type="button" data-filter="${f}">${FILTER_LABEL[f]}<span class="count" data-count="${f}"></span></button>`,
        ).join("")}
      </div>
    </div>
    <div class="list" id="list"></div>

    <div class="sheet-backdrop" id="sheet-backdrop"></div>
    <div class="sheet glass-strong" id="sheet">
      <div class="sheet-grabber" id="sheet-grabber"></div>
      <div class="sheet-status-row" id="sheet-status-row">
        ${(["idea", "doing", "done"] as ChallengeStatus[])
          .map((s) => `<button type="button" data-status="${s}">${STATUS_LABEL[s]}</button>`)
          .join("")}
      </div>
      <textarea class="title-field" id="sheet-title" rows="1" maxlength="300" placeholder="タイトル"></textarea>
      <textarea class="note-field" id="sheet-note" rows="3" maxlength="5000" placeholder="メモ（任意）"></textarea>
      <button type="button" class="sheet-ai-btn" id="sheet-ai-btn">${ICON_SPARKLE} AIで最初の一歩を提案</button>
      <div class="sheet-footer">
        <button type="button" class="delete-btn" id="sheet-delete">削除</button>
        <button type="button" class="close-btn" id="sheet-close">閉じる</button>
      </div>
    </div>

    <div class="toast" id="toast">
      <span id="toast-msg"></span>
      <button type="button" id="toast-undo">元に戻す</button>
    </div>
  `;

  requestAnimationFrame(() => requestAnimationFrame(hideBootSkeleton));
  // スケルトンが溶けるのに合わせて、ヘッダー要素を上から順に浮かび上がらせる
  [".brand", "#avatar-btn", "#capture-form", "#segmented"].forEach((sel, i) => {
    play(
      app.querySelector(sel),
      [
        { opacity: 0, transform: "translateY(14px) scale(0.97)", filter: "blur(6px)" },
        { opacity: 1, transform: "none", filter: "blur(0px)" },
      ],
      { spring: SPRING.soft, delay: 60 + i * 60, fill: "backwards" },
    );
  });

  wireCapture();
  wireSegmented();
  wireSheet();
  document.getElementById("avatar-btn")!.addEventListener("click", onLogout);

  store.subscribe(renderList);
  renderList();

  void store.sync().catch(() => {
    /* オフライン：次回オンライン復帰時に再試行 */
  });
  window.addEventListener("online", () => void store.sync().catch(() => {}));

  const input = document.getElementById("capture-input") as HTMLTextAreaElement;
  // 「開いた瞬間メモができる」：ロード直後に入力欄へフォーカスする
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
}

async function onLogout() {
  try {
    await api.logout();
  } catch {
    /* noop */
  }
  location.reload();
}

// ---------------------------------------------------------------------------
// クイックキャプチャ
// ---------------------------------------------------------------------------
function wireCapture() {
  const form = document.getElementById("capture-form") as HTMLFormElement;
  const input = document.getElementById("capture-input") as HTMLTextAreaElement;
  const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
  const aiBtn = document.getElementById("ai-split-btn") as HTMLButtonElement;

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(110, input.scrollHeight)}px`;
    const wasDisabled = sendBtn.disabled;
    sendBtn.disabled = input.value.trim().length === 0;
    // 送信できる状態になった瞬間、ボタンがポンと膨らむ
    if (wasDisabled && !sendBtn.disabled) {
      play(sendBtn, [{ transform: "scale(0.7)" }, { transform: "scale(1)" }], { spring: SPRING.bouncy });
    }
  }

  function flyPlane() {
    const icon = sendBtn.querySelector("svg");
    play(
      icon,
      [
        { transform: "none", opacity: 1 },
        { transform: "translate(22px, -22px) rotate(-12deg) scale(0.5)", opacity: 0, offset: 0.4 },
        { transform: "translate(-16px, 16px) scale(0.5)", opacity: 0, offset: 0.41 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 620, easing: EASE_OUT },
    );
    play(form, [{ transform: "scale(1)" }, { transform: "scale(0.985)" }, { transform: "scale(1)" }], {
      duration: 320,
    });
  }
  input.addEventListener("input", autoGrow);
  autoGrow();

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    flyPlane();
    store.create(text.replace(/\s*\n+\s*/g, " "));
    input.value = "";
    autoGrow();
  });

  aiBtn.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) {
      // 空のまま押したら「入力して」と首を振る
      play(form, [0, -7, 6, -4, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380 });
      return;
    }
    if (aiBtn.classList.contains("spinning")) return;
    aiBtn.classList.add("spinning");
    form.classList.add("ai-working");
    sendBtn.disabled = true;
    try {
      const { items } = await api.aiSplit(text);
      if (items.length) {
        store.createMany(items);
        input.value = "";
        autoGrow();
      } else {
        store.create(text.replace(/\s*\n+\s*/g, " "));
        input.value = "";
        autoGrow();
      }
    } catch {
      showToast("AIでの分割に失敗しました（ネットワークをご確認ください）");
    } finally {
      aiBtn.classList.remove("spinning");
      form.classList.remove("ai-working");
    }
  });
}

// ---------------------------------------------------------------------------
// セグメントタブ
// ---------------------------------------------------------------------------
function wireSegmented() {
  const seg = document.getElementById("segmented")!;
  seg.querySelectorAll<HTMLButtonElement>("button[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.filter as Filter;
      if (next === filter) return;
      filterDir = Math.sign(FILTERS.indexOf(next) - FILTERS.indexOf(filter));
      filter = next;
      // つまみが移動中に横へ伸びて縦に縮む（ゼリーのような慣性表現）
      play(
        seg.querySelector(".thumb"),
        [{ scale: "1 1" }, { scale: "1.22 0.88", offset: 0.35 }, { scale: "1 1" }],
        { duration: 460, easing: EASE_OUT, composite: "add" },
      );
      updateSegmentedUI();
      renderList();
      filterDir = 0;
    });
  });
  updateSegmentedUI();
}

function updateSegmentedUI() {
  const seg = document.getElementById("segmented")!;
  const idx = FILTERS.indexOf(filter);
  const thumb = seg.querySelector<HTMLElement>(".thumb")!;
  thumb.style.transform = `translateX(${idx * 100}%)`;
  seg.querySelectorAll<HTMLButtonElement>("button[data-filter]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  for (const f of FILTERS) {
    const n = f === "all" ? store.challenges.length : store.challenges.filter((c) => c.status === f).length;
    const el = seg.querySelector<HTMLElement>(`[data-count="${f}"]`);
    const text = n > 0 ? String(n) : "";
    if (el && el.textContent !== text) {
      const had = el.textContent !== "";
      el.textContent = text;
      // 件数が変わったらバッジが跳ねる（初回表示時は跳ねさせない）
      if (had || !firstPaint) {
        play(el, [{ transform: "translateY(-5px) scale(1.5)" }, { transform: "none" }], { spring: SPRING.bouncy });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// リスト描画（新規=enter / 対象外化=leave のアニメーションだけを差分適用する軽量diff）
// ---------------------------------------------------------------------------
const cardEls = new Map<string, HTMLElement>();

function matchesFilter(c: Challenge): boolean {
  return filter === "all" || c.status === filter;
}

function renderList() {
  updateSegmentedUI();
  const listEl = document.getElementById("list");
  if (!listEl) return;
  const visible = store.challenges.filter(matchesFilter);
  const visibleIds = new Set(visible.map((c) => c.id));

  // FLIP の First：変更前の位置を記録
  const before = measure(cardEls.values());

  // 対象外になったカードは、その場で浮かせて（absolute）退場させる。
  // 流れから外すので残りのカードは即座に詰まり、FLIP でなめらかに移動して見える。
  // （先に全員の位置を測ってから浮かせる。1枚ずつ浮かせると後続の位置がずれるため）
  const leaving = [...cardEls]
    .filter(([id]) => !visibleIds.has(id))
    .map(([id, el]) => ({ id, el, box: { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth } }));
  for (const { id, el, box } of leaving) {
    cardEls.delete(id);
    leaveCard(el, id, box);
  }

  const empty = listEl.querySelector<HTMLElement>(".empty-state");
  if (visible.length === 0 && store.loaded) {
    if (!empty) {
      const div = document.createElement("div");
      div.className = "empty-state";
      div.innerHTML = `${ICON_EMPTY}<span>${
        filter === "all" ? "まだ何もありません。上の入力欄から追加しましょう" : "該当するチャレンジはありません"
      }</span>`;
      listEl.appendChild(div);
      play(div, [{ opacity: 0, transform: "translateY(12px) scale(0.96)" }, { opacity: 1, transform: "none" }], {
        spring: SPRING.soft,
        delay: 120,
        fill: "backwards",
      });
    }
    firstPaint = false;
    return;
  }
  if (empty) empty.remove();

  let prevEl: HTMLElement | null = null;
  let enterIndex = 0;
  const entered = new Set<HTMLElement>();
  for (const c of visible) {
    let el = cardEls.get(c.id);
    if (!el) {
      el = buildCard(c);
      cardEls.set(c.id, el);
      listEl.insertBefore(el, prevEl ? prevEl.nextSibling : listEl.firstChild);
      entered.add(el);
      enterCard(el, enterIndex++);
    } else {
      updateCard(el, c);
      if (prevEl ? prevEl.nextSibling !== el : listEl.firstChild !== el) {
        listEl.insertBefore(el, prevEl ? prevEl.nextSibling : listEl.firstChild);
      }
    }
    prevEl = el;
  }

  // FLIP の Last/Invert/Play：残ったカードを旧位置から新位置へバネで移動
  flip(before, entered);
  firstPaint = false;
}

/** カードの登場。初回は上から順番に、タブ切替は切替方向から、追加は上から落ちてくる */
function enterCard(el: HTMLElement, index: number) {
  const delay = firstPaint ? 140 + Math.min(index, 10) * 55 : Math.min(index, 8) * 70;
  const from = filterDir
    ? `translateX(${filterDir * 46}px) scale(0.96)`
    : firstPaint
      ? "translateY(18px) scale(0.96)"
      : "translateY(-22px) scale(0.9)";
  play(
    el,
    [
      { opacity: 0, transform: from, filter: "blur(8px)" },
      { opacity: 1, transform: "none", filter: "blur(0px)" },
    ],
    { spring: filterDir ? SPRING.soft : SPRING.bouncy, delay, fill: "backwards" },
  );
}

/** カードの退場。削除は縮んで沈む／フリックで条件外へ出たらその方向へ飛ぶ／タブ切替は逆方向へ流れる */
function leaveCard(el: HTMLElement, id: string, box: { top: number; left: number; width: number }) {
  if (!el.parentElement || reduced()) {
    el.remove();
    return;
  }
  const { top, left, width } = box;
  Object.assign(el.style, {
    position: "absolute",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "0",
  });
  let to: string;
  if (lastSwipe?.id === id) to = `translateX(${lastSwipe.dir * 120}px) rotate(${lastSwipe.dir * 6}deg) scale(0.9)`;
  else if (filterDir) to = `translateX(${-filterDir * 46}px) scale(0.96)`;
  else to = "translateY(8px) scale(0.82)";
  const a = el.animate(
    [
      { opacity: 1, transform: "none", filter: "blur(0px)" },
      { opacity: 0, transform: to, filter: "blur(6px)" },
    ],
    { duration: 300, easing: EASE_OUT, fill: "forwards" },
  );
  a.onfinish = () => el.remove();
}

function buildCard(c: Challenge): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-wrap";
  wrap.innerHTML = `
    <div class="swipe-hint right"><span class="hint-label"></span></div>
    <div class="swipe-hint left"><span class="hint-label"></span></div>
    <div class="card glass">
      <div class="card-status-dot"></div>
      <div class="card-body">
        <div class="card-title"><span></span></div>
        <div class="card-note-preview"></div>
      </div>
      <div class="status-chip"></div>
    </div>
  `;
  const cardEl = wrap.querySelector<HTMLElement>(".card")!;
  const rightHint = wrap.querySelector<HTMLElement>(".swipe-hint.right")!;
  const leftHint = wrap.querySelector<HTMLElement>(".swipe-hint.left")!;
  let justDragged = false;
  let armed: 0 | 1 | -1 = 0;
  let canRight = false;
  let canLeft = false;
  const THRESHOLD = 68;

  /** ドラッグ開始時に、左右それぞれ「どのステータスへ移るか」で色と文言を決める */
  function prepareHints() {
    const c = store.byId(wrap.dataset.id!);
    const order: ChallengeStatus[] = ["idea", "doing", "done"];
    const i = c ? order.indexOf(c.status) : 0;
    const next = order[i + 1];
    const prev = order[i - 1];
    canRight = !!next;
    canLeft = !!prev;
    if (next) {
      rightHint.style.setProperty("--hint", STATUS_COLOR[next]);
      rightHint.querySelector(".hint-label")!.textContent = next === "done" ? "達成！ →" : `${STATUS_LABEL[next]}へ →`;
    }
    if (prev) {
      leftHint.style.setProperty("--hint", STATUS_COLOR[prev]);
      leftHint.querySelector(".hint-label")!.textContent = `← ${STATUS_LABEL[prev]}へ`;
    }
  }

  /** 端を越えるほど重くなるゴムのような抵抗。進めない方向はさらに強く抵抗する */
  function rubber(dx: number): number {
    const can = dx > 0 ? canRight : canLeft;
    const limit = can ? 110 : 28;
    const a = Math.abs(dx);
    const v = a < limit ? a : limit + (a - limit) * (can ? 0.32 : 0.12);
    return Math.sign(dx) * v;
  }

  attachDrag(cardEl, {
    axis: "x",
    onStart: () => {
      prepareHints();
      armed = 0;
      cardEl.classList.add("dragging");
      wrap.classList.add("dragging");
    },
    onMove: (dx) => {
      const x = rubber(dx);
      // 指に吸い付きつつ、わずかに傾いて持ち上がる
      cardEl.style.transform = `translateX(${x}px) rotate(${x * 0.035}deg) scale(1.015)`;
      const pr = Math.min(1, Math.abs(x) / THRESHOLD);
      rightHint.style.opacity = x > 0 && canRight ? String(pr) : "0";
      leftHint.style.opacity = x < 0 && canLeft ? String(pr) : "0";
      const nowArmed: 0 | 1 | -1 = x > THRESHOLD && canRight ? 1 : x < -THRESHOLD && canLeft ? -1 : 0;
      if (nowArmed !== armed) {
        armed = nowArmed;
        rightHint.classList.toggle("armed", armed === 1);
        leftHint.classList.toggle("armed", armed === -1);
        // しきい値を越えた瞬間、ラベルがポンと弾んで「離せば確定」を伝える
        if (armed) {
          play((armed === 1 ? rightHint : leftHint).querySelector(".hint-label"), [
            { transform: "scale(0.8)" },
            { transform: "scale(1)" },
          ], { spring: SPRING.bouncy });
          navigator.vibrate?.(8);
        }
      }
    },
    onEnd: (dx) => {
      cardEl.classList.remove("dragging");
      wrap.classList.remove("dragging");
      const id = wrap.dataset.id!;
      const from = cardEl.style.transform;
      cardEl.style.transform = "";
      rightHint.classList.remove("armed");
      leftHint.classList.remove("armed");
      rightHint.style.opacity = "0";
      leftHint.style.opacity = "0";
      const commit = armed;
      armed = 0;
      if (commit) {
        justDragged = true;
        lastSwipe = { id, dir: commit };
        store.cycleStatus(id, commit);
        lastSwipe = null;
        setTimeout(() => (justDragged = false), 80);
      } else if (Math.abs(dx) > 4) {
        justDragged = true;
        setTimeout(() => (justDragged = false), 80);
      }
      // 離した位置からバネで戻る（行き過ぎてから収まる）
      if (cardEl.isConnected && from) {
        play(cardEl, [{ transform: from }, { transform: "none" }], { spring: commit ? SPRING.bouncy : SPRING.soft });
      }
    },
  });

  cardEl.addEventListener("click", () => {
    if (justDragged) return;
    const id = wrap.dataset.id!;
    const c = store.byId(id);
    if (c) openSheet(c);
  });

  updateCard(wrap, c);
  return wrap;
}

function updateCard(wrap: HTMLElement, c: Challenge) {
  wrap.dataset.id = c.id;
  const cardEl = wrap.querySelector<HTMLElement>(".card")!;
  const prevStatus = cardEl.dataset.status;
  cardEl.dataset.status = c.status;
  cardEl.className = `card glass status-${c.status}`;
  (wrap.querySelector(".card-title span") as HTMLElement).textContent = c.title;
  const notePreview = wrap.querySelector(".card-note-preview") as HTMLElement;
  notePreview.textContent = c.note ? c.note.split("\n")[0] ?? "" : "";
  notePreview.style.display = c.note ? "" : "none";
  const dot = wrap.querySelector(".card-status-dot") as HTMLElement;
  dot.style.background = STATUS_COLOR[c.status];
  dot.style.setProperty("--dot-bg", `${STATUS_COLOR[c.status]}22`);
  const chip = wrap.querySelector(".status-chip") as HTMLElement;
  chip.textContent = STATUS_LABEL[c.status];
  chip.className = `status-chip ${c.status}`;

  if (prevStatus && prevStatus !== c.status) celebrateStatus(wrap, cardEl, c.status, prevStatus as ChallengeStatus);

  if (openSheetId === c.id) syncSheetFields(c);
}

/** ステータス変化の演出：チップが弾む・ドットから波紋・カードを色が横切る・達成なら紙吹雪 */
function celebrateStatus(wrap: HTMLElement, cardEl: HTMLElement, status: ChallengeStatus, prev: ChallengeStatus) {
  const color = STATUS_COLOR[status];
  const forward = (["idea", "doing", "done"] as const).indexOf(status) > (["idea", "doing", "done"] as const).indexOf(prev);
  play(
    wrap.querySelector(".status-chip"),
    [
      { transform: "scale(0.4) rotate(-8deg)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { spring: SPRING.bouncy },
  );
  const dot = wrap.querySelector<HTMLElement>(".card-status-dot")!;
  play(dot, [{ transform: "scale(0.3)" }, { transform: "scale(1.6)", offset: 0.4 }, { transform: "none" }], {
    duration: 520,
    easing: EASE_OUT,
  });
  pulseRing(dot, color);
  // 進んだら左→右、戻したら右→左へ色が走る
  cardEl.style.setProperty("--sweep", `${color}33`);
  play(
    cardEl.querySelector(".card-sweep") ?? cardEl.appendChild(Object.assign(document.createElement("div"), { className: "card-sweep" })),
    [
      { transform: `translateX(${forward ? "-100%" : "100%"})`, opacity: 1 },
      { transform: `translateX(${forward ? "100%" : "-100%"})`, opacity: 0.2 },
    ],
    { duration: 650, easing: EASE_OUT },
  );
  if (status === "done") {
    const r = dot.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    play(cardEl, [{ transform: "scale(1)" }, { transform: "scale(1.035)", offset: 0.3 }, { transform: "none" }], {
      duration: 520,
      easing: EASE_OUT,
      composite: "add",
    });
  }
}

// ---------------------------------------------------------------------------
// 詳細ボトムシート
// ---------------------------------------------------------------------------
function wireSheet() {
  const backdrop = document.getElementById("sheet-backdrop")!;
  const sheet = document.getElementById("sheet")!;
  const grabber = document.getElementById("sheet-grabber")!;
  const titleField = document.getElementById("sheet-title") as HTMLTextAreaElement;
  const noteField = document.getElementById("sheet-note") as HTMLTextAreaElement;
  const statusRow = document.getElementById("sheet-status-row")!;
  const aiBtn = document.getElementById("sheet-ai-btn") as HTMLButtonElement;

  backdrop.addEventListener("click", closeSheet);
  document.getElementById("sheet-close")!.addEventListener("click", closeSheet);

  document.getElementById("sheet-delete")!.addEventListener("click", () => {
    if (!openSheetId) return;
    const id = openSheetId;
    const removed = store.byId(id);
    closeSheet();
    if (!removed) return;
    store.remove(id);
    showToast("削除しました", () => store.restore(removed));
  });

  attachDrag(grabber, {
    axis: "y",
    onStart: () => sheet.classList.add("dragging"),
    onMove: (dy) => {
      if (dy < 0) return;
      sheet.style.transform = `translateY(${dy}px)`;
    },
    onEnd: (dy) => {
      sheet.classList.remove("dragging");
      sheet.style.transform = "";
      if (dy > 90) closeSheet();
    },
  });

  function flushTitle() {
    if (!openSheetId) return;
    store.update(openSheetId, { title: titleField.value.trim() || "無題" });
  }
  function flushNote() {
    if (!openSheetId) return;
    store.update(openSheetId, { note: noteField.value });
  }
  titleField.addEventListener("blur", flushTitle);
  noteField.addEventListener("input", () => {
    if (pendingNoteFlush) window.clearTimeout(pendingNoteFlush);
    pendingNoteFlush = window.setTimeout(flushNote, 500);
  });
  noteField.addEventListener("blur", flushNote);

  statusRow.querySelectorAll<HTMLButtonElement>("button[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!openSheetId) return;
      store.update(openSheetId, { status: btn.dataset.status as ChallengeStatus });
      statusRow.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      play(btn, [{ transform: "scale(0.88)" }, { transform: "none" }], { spring: SPRING.bouncy });
    });
  });

  aiBtn.addEventListener("click", async () => {
    if (!openSheetId || aiBtn.classList.contains("spinning")) return;
    const c = store.byId(openSheetId);
    if (!c) return;
    aiBtn.classList.add("spinning");
    try {
      const { items } = await api.aiBreakdown(`${c.title}\n${c.note}`.trim());
      if (items.length) {
        const addition = items.map((i) => `- ${i}`).join("\n");
        const prefix = noteField.value ? "\n" : "";
        // AIが書いているように一文字ずつ流し込み、書き終えたら保存
        noteField.classList.add("ai-writing");
        await new Promise<void>((resolve) => typeInto(noteField, prefix + addition, resolve));
        noteField.classList.remove("ai-writing");
        flushNote();
      }
    } catch {
      showToast("AIの提案取得に失敗しました");
    } finally {
      aiBtn.classList.remove("spinning");
    }
  });
}

function syncSheetFields(c: Challenge) {
  const titleField = document.getElementById("sheet-title") as HTMLTextAreaElement;
  const noteField = document.getElementById("sheet-note") as HTMLTextAreaElement;
  if (document.activeElement !== titleField) titleField.value = c.title;
  if (document.activeElement !== noteField) noteField.value = c.note;
  document.querySelectorAll("#sheet-status-row button").forEach((b) => {
    b.classList.toggle("active", (b as HTMLElement).dataset.status === c.status);
  });
}

function openSheet(c: Challenge) {
  openSheetId = c.id;
  syncSheetFields(c);
  document.getElementById("sheet-backdrop")!.classList.add("open");
  const sheet = document.getElementById("sheet")!;
  sheet.classList.add("open");
  // シートの中身を上から順にふわっと出す
  [...sheet.children].forEach((child, i) => {
    if (child.id === "sheet-grabber") return;
    play(child, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], {
      spring: SPRING.soft,
      delay: 70 + i * 40,
      fill: "backwards",
    });
  });
}

function closeSheet() {
  if (pendingNoteFlush) {
    window.clearTimeout(pendingNoteFlush);
    pendingNoteFlush = null;
    const noteField = document.getElementById("sheet-note") as HTMLTextAreaElement;
    if (openSheetId) store.update(openSheetId, { note: noteField.value });
  }
  const titleField = document.getElementById("sheet-title") as HTMLTextAreaElement;
  if (openSheetId) {
    // 変更がないのに保存すると updatedAt が進み、直後の削除と競合して復活する原因になるため、差分があるときだけ保存
    const title = titleField.value.trim() || "無題";
    if (store.byId(openSheetId)?.title !== title) store.update(openSheetId, { title });
  }
  openSheetId = null;
  document.getElementById("sheet-backdrop")!.classList.remove("open");
  document.getElementById("sheet")!.classList.remove("open");
}

// ---------------------------------------------------------------------------
// トースト（削除の取り消しなどの軽い通知）
// ---------------------------------------------------------------------------
let toastTimer: number | null = null;
function showToast(message: string, onUndo?: () => void) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  (document.getElementById("toast-msg") as HTMLElement).textContent = message;
  const undoBtn = document.getElementById("toast-undo") as HTMLButtonElement;
  undoBtn.style.display = onUndo ? "" : "none";
  undoBtn.onclick = () => {
    onUndo?.();
    hideToast();
  };
  // 残り時間バーのアニメーションを毎回最初から走らせる
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  play(toast.querySelector("#toast-msg"), [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
    duration: 300,
    delay: 80,
    fill: "backwards",
  });
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 3200);
}
function hideToast() {
  document.getElementById("toast")?.classList.remove("show");
}

boot();
