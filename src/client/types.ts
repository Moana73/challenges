export type ChallengeStatus = "idea" | "doing" | "done";

export interface Challenge {
  id: string;
  title: string;
  note: string;
  status: ChallengeStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
  /** サーバーにまだ反映できていない変更があるか（オフライン対応用、クライアントのみで使用） */
  dirty?: boolean;
  /** サーバー側で削除済み・ローカルでも削除予約中（楽観的UI用） */
  deleting?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export const STATUS_ORDER: ChallengeStatus[] = ["idea", "doing", "done"];

export const STATUS_LABEL: Record<ChallengeStatus, string> = {
  idea: "やりたい",
  doing: "挑戦中",
  done: "達成",
};
