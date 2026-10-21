import type { Env } from "./types";
import { handleAuth } from "./auth";
import { handleApi } from "./api";
import { json } from "./http";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/auth/")) return await handleAuth(req, env, url);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url);
      return await env.ASSETS.fetch(req);
    } catch (e) {
      console.error("unhandled", e);
      return json({ error: "internal" }, 500);
    }
  },
};
