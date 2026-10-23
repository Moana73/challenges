import { api, AuthRequiredError } from "./api";
import { idbDelete, idbGetAll, idbPut } from "./idb";
import type { Challenge, ChallengeStatus } from "./types";

type Listener = () => void;

class Store {
  challenges: Challenge[] = [];
  loaded = false;
  private listeners = new Set<Listener>();
  private deletedAt = new Map<string, number>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** IndexedDB からの初回読み込み（オフラインでも即座に表示できる） */
  async hydrate() {
    this.challenges = (await idbGetAll()).filter((c) => !c.deleting);
    this.sortInPlace();
    this.loaded = true;
    this.emit();
  }

  private sortInPlace() {
    this.challenges.sort((a, b) => b.createdAt - a.createdAt);
  }

  byId(id: string): Challenge | undefined {
    return this.challenges.find((c) => c.id === id);
  }

  /** 新規チャレンジを即座に作成（楽観的UI：ローカルへの書き込みを待たず描画してから永続化する） */
  create(title: string): Challenge {
    const now = Date.now();
    const c: Challenge = {
      id: crypto.randomUUID(),
      title: title.trim(),
      note: "",
      status: "idea",
      position: now,
      createdAt: now,
      updatedAt: now,
      dirty: true,
    };
    this.challenges.unshift(c);
    this.emit();
    void idbPut(c).then(() => this.push(c));
    return c;
  }

  createMany(titles: string[]) {
    for (const t of titles.reverse()) this.create(t);
  }

  update(id: string, patch: Partial<Pick<Challenge, "title" | "note" | "status">>) {
    const c = this.byId(id);
    if (!c) return;
    Object.assign(c, patch, { updatedAt: Date.now(), dirty: true });
    this.sortIfNeeded();
    this.emit();
    void idbPut(c).then(() => this.push(c));
  }

  cycleStatus(id: string, dir: 1 | -1) {
    const c = this.byId(id);
    if (!c) return;
    const order: ChallengeStatus[] = ["idea", "doing", "done"];
    const i = order.indexOf(c.status);
    const next = order[Math.min(order.length - 1, Math.max(0, i + dir))];
    if (!next || next === c.status) return;
    this.update(id, { status: next });
  }

  /** 削除の取り消し：同じ内容で再度 upsert する（Undoトースト用） */
  restore(c: Challenge) {
    // 削除リクエストより必ず新しい時刻にする（同じミリ秒だとサーバー側で削除が優先される）
    const deletedAt = this.deletedAt.get(c.id) ?? 0;
    const restored: Challenge = { ...c, updatedAt: Math.max(Date.now(), deletedAt + 1), dirty: true };
    this.challenges.unshift(restored);
    this.sortInPlace();
    this.emit();
    void idbPut(restored).then(() => this.push(restored));
  }

  remove(id: string) {
    const i = this.challenges.findIndex((c) => c.id === id);
    if (i === -1) return;
    this.challenges.splice(i, 1);
    this.emit();
    const ts = Date.now();
    this.deletedAt.set(id, ts);
    void idbDelete(id);
    void api.remove(id, ts).catch(() => {
      /* オフライン等で失敗しても、起動時の再同期では取り上げない（削除は再送しない設計） */
    });
  }

  private sortIfNeeded() {
    // createdAt は変えないため並び替えは基本不要（新しい順を維持）
  }

  /** 1件をサーバーへ反映。失敗時は dirty のまま残り、次回フラッシュで再送される */
  private async push(c: Challenge) {
    try {
      await api.put(c);
      c.dirty = false;
      // 送信中に削除された場合はローカルDBへ書き戻さない（書き戻すと次回起動時に復活する）
      if (this.challenges.includes(c)) void idbPut(c);
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      // オフライン・一時的なエラー：dirty のままにして later flush に任せる
    }
  }

  /** 起動時・オンライン復帰時：未送信分をまとめて送り、サーバーの最新状態を取り込む */
  async sync() {
    for (const c of [...this.challenges]) {
      if (c.dirty) await this.push(c);
    }
    const { challenges: remote } = await api.list();
    const localById = new Map(this.challenges.map((c) => [c.id, c]));
    for (const r of remote) {
      const local = localById.get(r.id);
      if (!local || (!local.dirty && r.updatedAt > local.updatedAt)) {
        const merged: Challenge = { ...r };
        localById.set(r.id, merged);
        void idbPut(merged);
      }
    }
    this.challenges = [...localById.values()];
    this.sortInPlace();
    this.emit();
  }
}

export const store = new Store();
