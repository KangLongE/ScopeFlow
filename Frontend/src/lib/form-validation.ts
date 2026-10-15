export type FieldError = { fieldPath: string; message: string };
export function controlMessage(label: string, value: string, rules: { required?: boolean; type?: string; checked?: boolean; min?: string; max?: string; minLength?: number; maxLength?: number; badInput?: boolean; typeMismatch?: boolean; stepMismatch?: boolean; patternMismatch?: boolean }) {
  const last = label.charCodeAt(label.length - 1); const final = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  const object = label + (final ? "을" : "를"); const subject = label + (final ? "은" : "는");
  if (rules.required && (rules.type === "checkbox" ? !rules.checked : !value.trim())) return rules.type === "checkbox" ? "내용을 확인하고 동의해주세요." : object + " 입력해주세요.";
  if (rules.badInput) return label + "에 올바른 숫자를 입력해주세요.";
  if (!value && !rules.required) return null;
  if (rules.typeMismatch) return rules.type === "email" ? "올바른 이메일 주소를 입력해주세요." : "올바른 주소 형식으로 입력해주세요.";
  if (rules.type === "number" && !Number.isFinite(Number(value))) return label + "에 올바른 숫자를 입력해주세요.";
  if (rules.min !== undefined && rules.min !== "" && (rules.type === "number" ? Number(value) < Number(rules.min) : value < rules.min)) return subject + " " + rules.min + " 이상으로 입력해주세요.";
  if (rules.max !== undefined && rules.max !== "" && (rules.type === "number" ? Number(value) > Number(rules.max) : value > rules.max)) return subject + " " + rules.max + " 이하로 입력해주세요.";
  if (rules.minLength && value.length < rules.minLength) return subject + " " + rules.minLength + "자 이상 입력해주세요.";
  if (rules.maxLength && rules.maxLength > 0 && value.length > rules.maxLength) return subject + " " + rules.maxLength + "자 이하로 입력해주세요.";
  if (rules.stepMismatch) return object + " 허용된 단위에 맞춰 입력해주세요.";
  if (rules.patternMismatch) return label + "의 형식을 확인해주세요.";
  return null;
}
