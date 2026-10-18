import type { z } from "zod";
import type { conditionSchema } from "./model";
import { fingerprint } from "./fingerprint";

type Source = { id: string; kind: string; text: string; revision: string };
// shortcut: bounded literal conditions, not a general language parser; ambiguous wording requires review.
export function sourceConditions(sources: Source[]): z.infer<typeof conditionSchema>[] {
  return sources.filter(s => ["REQUEST", "ANSWER"].includes(s.kind)).flatMap(s => {
    const text = s.kind === "ANSWER" ? s.text.slice(s.text.indexOf("\n") + 1) : s.text;
    return text.split(/[\n.!?。]/).filter(Boolean).flatMap(evidence => {
      const conditions: { key: string; value: number | boolean; pending: boolean }[] = [];
      const uncertain = /미정|논의|추후|나중|확인\s*필요|아마|고려|할까요/.test(evidence);
      const onePage = /(?:같은|동일|한|단일)\s*(?:1\s*)?페이지|1\s*페이지|원\s*페이지|one[- ]page|single[- ]page/i.test(evidence);
      if (onePage && !/1\s*페이지(?:가|는|도)?\s*(?:아니|아닌|아님)|한\s*페이지(?:가|는)?\s*(?:아니|아닌)/.test(evidence)) conditions.push({ key: "pageCount", value: 1, pending: uncertain });
      const provided = /고객|클라이언트|client|customer/i.test(evidence) && /제공|전달|provided|supplied/i.test(evidence);
      if (provided && !/제공\s*(?:하지\s*않|안|불가)|제공하지|미제공/.test(evidence)) {
        for (const [key, pattern] of [["logoProvided", /로고|logo/i], ["menuProvided", /메뉴|menu/i]] as const) if (pattern.test(evidence)) conditions.push({ key, value: true, pending: uncertain });
      }
      return conditions.map(c => ({ id: `source-condition:${fingerprint([s.id, c.key, evidence]).slice(0, 24)}`, key: c.key, value: c.value, status: c.pending ? "pending" as const : "explicit" as const, evidence, sourceRefs: [s.id], supersedes: [] }));
    });
  });
}
