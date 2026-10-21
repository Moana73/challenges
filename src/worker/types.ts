export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_EMAILS?: string;
  AI_MODEL?: string;
  AI_MOCK?: string;
  DEV_LOGIN?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export type ChallengeStatus = "idea" | "doing" | "done";

export interface Challenge {
  id: string;
  title: string;
  note: string;
  status: ChallengeStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
}
