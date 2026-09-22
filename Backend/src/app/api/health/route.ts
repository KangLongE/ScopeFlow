import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const GET = route(async () => json({ status: "ok" }));

