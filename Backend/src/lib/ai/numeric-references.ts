type NumericReference = { fieldPath: string; value: number; text: string };

// Model prose is still checked separately; field links are derived from the actual JSON, never guessed.
export function numericReferences(value: unknown): NumericReference[] {
  const result: NumericReference[] = [];
  const visit = (node: unknown, path: string) => {
    if (typeof node === "number" && Number.isFinite(node)) result.push({ fieldPath: path, value: node, text: `${path} = ${node}` });
    else if (Array.isArray(node)) node.forEach((item, i) => visit(item, `${path}.${i}`));
    else if (node && typeof node === "object") for (const [key, item] of Object.entries(node)) if (key !== "numericReferences") visit(item, path ? `${path}.${key}` : key);
  };
  visit(value, "");
  return result.sort((a, b) => a.fieldPath.localeCompare(b.fieldPath)).slice(0, 40);
}

export function refreshNumericReferences<T>(value: T): T {
  if (!value || typeof value !== "object" || !("numericReferences" in value) || !Array.isArray(value.numericReferences)) return value;
  const refs = value.numericReferences as NumericReference[];
  const derived = (r: NumericReference) => r && r.text === `${r.fieldPath} = ${r.value}`;
  if (!refs.some(derived)) return value;
  return { ...value, numericReferences: [...refs.filter(r => !derived(r)), ...numericReferences(value)].slice(0, 40) };
}
