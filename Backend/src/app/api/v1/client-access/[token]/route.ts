import { z } from "zod";
import { json, route } from "@/lib/http";
import { clientAccessService } from "@/lib/services/workflow.service";

type P = { token: string };
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const GET = route<P>(async (_request, params) => json(await clientAccessService.get(tokenSchema.parse(params.token))));

