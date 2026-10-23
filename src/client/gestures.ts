// Pointer Events ベースの汎用ドラッグ検出。
// タッチ（実機フリック）とマウス（デスクトップでのドラッグ操作によるテスト）の
// 両方を同じコードパスで扱えるため、タッチイベント専用のライブラリは使わない。
interface DragHandlers {
  axis: "x" | "y";
  threshold?: number;
  onStart?: () => void;
  onMove: (delta: number, raw: { dx: number; dy: number }) => void;
  onEnd: (delta: number, velocity: number) => void;
}

export function attachDrag(el: HTMLElement, handlers: DragHandlers): () => void {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let lastX = 0;
  let lastT = 0;
  let dragging = false;
  let pointerId: number | null = null;

  function onPointerDown(e: PointerEvent) {
    if (pointerId !== null) return;
    if (e.button !== undefined && e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    lastX = e.clientX;
    lastT = startT;
    dragging = false;
  }

  function onPointerMove(e: PointerEvent) {
    if (pointerId !== e.pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging) {
      const primary = handlers.axis === "x" ? Math.abs(dx) : Math.abs(dy);
      const cross = handlers.axis === "x" ? Math.abs(dy) : Math.abs(dx);
      if (primary < 8 || primary < cross) return;
      dragging = true;
      handlers.onStart?.();
      // キャプチャに失敗しても（ポインタが既に離れた等）ドラッグ自体は続行する
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* noop */
      }
    }
    e.preventDefault();
    lastX = e.clientX;
    lastT = performance.now();
    handlers.onMove(handlers.axis === "x" ? dx : dy, { dx, dy });
  }

  function finish(e: PointerEvent) {
    if (pointerId !== e.pointerId) return;
    const dx = handlers.axis === "x" ? e.clientX - startX : e.clientY - startY;
    const dt = Math.max(1, performance.now() - startT);
    const velocity = dx / dt;
    pointerId = null;
    if (dragging) handlers.onEnd(dx, velocity);
    dragging = false;
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", finish);
    el.removeEventListener("pointercancel", finish);
  };
}
