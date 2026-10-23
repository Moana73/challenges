import { api, AuthRequiredError } from "./api";
import { attachDrag } from "./gestures";
import { GOOGLE_G_DATA_URI, ICON_EMPTY, ICON_FLAG, ICON_SEND, ICON_SPARKLE } from "./icons";
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
let openSheetId: string | null = null;
let pendingNoteFlush: number | null = null;

const bootSkeleton = document.getElementById("boot-skeleton")!;
const app = document.getElementById("app")!;

// ---------------------------------------------------------------------------
// ブート：認証確認とローカルデータの読み出しを並行で行い、できるだけ早く
// 「スケルトン → 本体」へ切り替える。オフライン時はローカルキャッシュのみで起動する。
// ---------------------------------------------------------------------------
async function boot() {
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
        <div class="login-mark">${ICON_FLAG}</div>
        <h1>Challenges</h1>
        <p>Googleアカウントでログインしてください</p>
        <a class="google-btn" href="/auth/google">
          <img src="${GOOGLE_G_DATA_URI}" alt="" width="18" height="18" />
          Googleでログイン
        </a>
        ${err ? `<div class="login-error">${loginErrorText(err)}</div>` : ""}
      </div>
    </div>
  `;
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
    sendBtn.disabled = input.value.trim().length === 0;
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
    store.create(text.replace(/\s*\n+\s*/g, " "));
    input.value = "";
    autoGrow();
  });

  aiBtn.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text || aiBtn.classList.contains("spinning")) return;
    aiBtn.classList.add("spinning");
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
      filter = btn.dataset.filter as Filter;
      updateSegmentedUI();
      renderList();
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
    if (el) el.textContent = n > 0 ? String(n) : "";
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

  if (visible.length === 0 && store.loaded) {
    if (!listEl.querySelector(".empty-state")) {
      for (const [id, el] of cardEls) {
        el.remove();
        cardEls.delete(id);
      }
      listEl.innerHTML = `<div class="empty-state">${ICON_EMPTY}<span>${
        filter === "all" ? "まだ何もありません。上の入力欄から追加しましょう" : "該当するチャレンジはありません"
      }</span></div>`;
    }
    return;
  }
  const empty = listEl.querySelector(".empty-state");
  if (empty) empty.remove();

  // 対象外になったカードは退場アニメーション後に削除
  for (const [id, el] of cardEls) {
    if (!visibleIds.has(id)) {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 340);
      cardEls.delete(id);
    }
  }

  let prevEl: HTMLElement | null = null;
  for (const c of visible) {
    let el = cardEls.get(c.id);
    if (!el) {
      el = buildCard(c);
      cardEls.set(c.id, el);
      el.classList.add("entering");
      listEl.insertBefore(el, prevEl ? prevEl.nextSibling : listEl.firstChild);
      requestAnimationFrame(() => requestAnimationFrame(() => el!.classList.remove("entering")));
    } else {
      updateCard(el, c);
      if (prevEl ? prevEl.nextSibling !== el : listEl.firstChild !== el) {
        listEl.insertBefore(el, prevEl ? prevEl.nextSibling : listEl.firstChild);
      }
    }
    prevEl = el;
  }
}

function buildCard(c: Challenge): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-wrap";
  wrap.innerHTML = `
    <div class="swipe-hint right">挑戦中へ →</div>
    <div class="swipe-hint left">← 一つ戻す</div>
    <div class="card glass">
      <div class="card-status-dot"></div>
      <div class="card-body">
        <div class="card-title"></div>
        <div class="card-note-preview"></div>
      </div>
      <div class="status-chip"></div>
    </div>
  `;
  const cardEl = wrap.querySelector<HTMLElement>(".card")!;
  let justDragged = false;

  attachDrag(cardEl, {
    axis: "x",
    onStart: () => cardEl.classList.add("dragging"),
    onMove: (dx) => {
      const clamped = Math.max(-140, Math.min(140, dx));
      cardEl.style.transform = `translateX(${clamped}px)`;
      const rightHint = wrap.querySelector<HTMLElement>(".swipe-hint.right")!;
      const leftHint = wrap.querySelector<HTMLElement>(".swipe-hint.left")!;
      rightHint.style.opacity = dx > 0 ? String(Math.min(1, dx / 70)) : "0";
      leftHint.style.opacity = dx < 0 ? String(Math.min(1, -dx / 70)) : "0";
    },
    onEnd: (dx) => {
      cardEl.classList.remove("dragging");
      const THRESHOLD = 68;
      const id = wrap.dataset.id!;
      const current = store.byId(id);
      if (current && dx > THRESHOLD && current.status !== "done") {
        justDragged = true;
        store.cycleStatus(id, 1);
      } else if (current && dx < -THRESHOLD && current.status !== "idea") {
        justDragged = true;
        store.cycleStatus(id, -1);
      }
      cardEl.style.transform = "translateX(0)";
      wrap.querySelectorAll<HTMLElement>(".swipe-hint").forEach((h) => (h.style.opacity = "0"));
      if (justDragged) setTimeout(() => (justDragged = false), 80);
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
  (wrap.querySelector(".card-title") as HTMLElement).textContent = c.title;
  const notePreview = wrap.querySelector(".card-note-preview") as HTMLElement;
  notePreview.textContent = c.note ? c.note.split("\n")[0] ?? "" : "";
  notePreview.style.display = c.note ? "" : "none";
  const dot = wrap.querySelector(".card-status-dot") as HTMLElement;
  dot.style.background = STATUS_COLOR[c.status];
  dot.style.setProperty("--dot-bg", `${STATUS_COLOR[c.status]}22`);
  const chip = wrap.querySelector(".status-chip") as HTMLElement;
  chip.textContent = STATUS_LABEL[c.status];
  chip.className = `status-chip ${c.status}`;

  if (prevStatus && prevStatus !== c.status) {
    cardEl.classList.add("just-changed");
    setTimeout(() => cardEl.classList.remove("just-changed"), 420);
  }

  if (openSheetId === c.id) syncSheetFields(c);
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
        noteField.value = noteField.value ? `${noteField.value}\n${addition}` : addition;
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
  document.getElementById("sheet")!.classList.add("open");
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
  toast.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 3200);
}
function hideToast() {
  document.getElementById("toast")?.classList.remove("show");
}

boot();
