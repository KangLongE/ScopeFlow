import { z } from "zod";
import { idSchema, moneySchema, ratesSchema, requirementInputSchema, textSchema, titleSchema } from "./model";

export const workspaceCreateSchema = z.object({ name: titleSchema });
export const workspaceUpdateSchema = workspaceCreateSchema.partial().refine((value) => Object.keys(value).length > 0);
export const clientCreateSchema = z.object({ name: titleSchema, email: z.string().email().max(320), company: z.string().trim().max(160).default(""), phone: z.string().trim().max(50).default(""), notes: z.string().trim().max(5000).default("") });
export const clientUpdateSchema = clientCreateSchema.partial().refine((value) => Object.keys(value).length > 0);
export const projectCreateSchema = z.object({ name: titleSchema, clientId: idSchema, budget: moneySchema.nullable().optional(), deadline: z.coerce.date().nullable().optional(), referenceUrl: z.union([z.literal(""), z.string().url().max(2000)]).default(""), notes: z.string().trim().max(5000).default("") });
export const projectUpdateSchema = projectCreateSchema.omit({ clientId: true }).extend({ status: z.enum(["DRAFT", "REQUIREMENT_GATHERING", "WAITING_SCOPE_APPROVAL", "ACTIVE", "WAITING_CHANGE_APPROVAL", "COMPLETED", "CANCELLED"]).optional() }).partial().refine((value) => Object.keys(value).length > 0);
export const requirementCreateSchema = requirementInputSchema.extend({ source: z.enum(["CLIENT_INITIAL", "CLIENT_ANSWER", "OWNER_MANUAL", "CHANGE_REQUEST"]).default("OWNER_MANUAL") });
export const requirementUpdateSchema = requirementInputSchema.partial().refine((value) => Object.keys(value).length > 0);
export const answerSchema = z.object({ content: textSchema, author: titleSchema });
export const rateCardSchema = z.object({ rates: ratesSchema });

