import { IQuestion, QuestionType } from "../models/Subcategory";

const TYPES: QuestionType[] = ["text", "number", "select", "radio", "checkbox", "boolean", "year", "date", "range", "textarea", "multi_select"];

function isValidDateAnswer(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateQuestionnaire(input: unknown): { valid: true; questions: IQuestion[] } | { valid: false; message: string } {
  if (!Array.isArray(input)) return { valid: false, message: "questionnaire must be an array" };
  const keys = new Set<string>();
  const questions: IQuestion[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return { valid: false, message: `Question ${i + 1} must be an object` };
    const key = String(raw.key ?? "").trim();
    const label = String(raw.label ?? "").trim();
    const type = String(raw.type ?? "") as QuestionType;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,49}$/.test(key)) return { valid: false, message: `Question ${i + 1}: invalid key` };
    if (keys.has(key)) return { valid: false, message: `Duplicate question key: ${key}` };
    if (!label || label.length > 120) return { valid: false, message: `Question ${key}: label is required (max 120)` };
    if (!TYPES.includes(type)) return { valid: false, message: `Question ${key}: unsupported type` };
    const options = Array.isArray(raw.options) ? raw.options.map(String).map(v => v.trim()).filter(Boolean) : [];
    if (["select", "radio", "multi_select"].includes(type) && options.length === 0) return { valid: false, message: `Question ${key}: options are required` };
    const min = raw.min === undefined ? undefined : Number(raw.min);
    const max = raw.max === undefined ? undefined : Number(raw.max);
    if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max)) || (min !== undefined && max !== undefined && min > max)) {
      return { valid: false, message: `Question ${key}: invalid min/max` };
    }
    let showWhen: IQuestion["showWhen"];
    if (raw.showWhen !== undefined) {
      const condition = raw.showWhen as Record<string, unknown>;
      const field = String(condition?.field ?? "");
      const operator = String(condition?.operator ?? "");
      if (!keys.has(field)) return { valid: false, message: `Question ${key}: showWhen must reference an earlier question` };
      if (!["equals", "not_equals"].includes(operator)) return { valid: false, message: `Question ${key}: invalid showWhen operator` };
      showWhen = { field, operator: operator as "equals" | "not_equals", value: String(condition.value ?? "") };
    }
    keys.add(key);
    questions.push({
      key, label, type, required: raw.required === true,
      placeholder: raw.placeholder ? String(raw.placeholder).slice(0, 160) : undefined,
      options, min, max, suffix: raw.suffix ? String(raw.suffix).slice(0, 30) : undefined,
      helpText: raw.helpText ? String(raw.helpText).slice(0, 250) : undefined,
      sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : i,
      showWhen
    });
  }
  return { valid: true, questions };
}

export function validateAnswers(questions: IQuestion[], answers: unknown): { valid: true } | { valid: false; errors: string[] } {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { valid: false, errors: ["attributes must be an object"] };
  const values = answers as Record<string, unknown>;
  const errors: string[] = [];
  const allowedKeys = new Set(questions.map(q => q.key));
  for (const key of Object.keys(values)) if (!allowedKeys.has(key)) errors.push(`Unknown field: ${key}`);
  const visible = (q: IQuestion) => {
    if (!q.showWhen) return true;
    const current = values[q.showWhen.field];
    return q.showWhen.operator === "equals" ? String(current ?? "") === q.showWhen.value : String(current ?? "") !== q.showWhen.value;
  };
  for (const q of questions) {
    if (!visible(q)) continue;
    const value = values[q.key];
    const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (q.required && empty) { errors.push(`${q.label} is required`); continue; }
    if (empty) continue;
    if (["text", "textarea"].includes(q.type) && (typeof value !== "string" || value.length > 3000)) errors.push(`${q.label} must be text (max 3000 characters)`);
    if (["number", "year", "range"].includes(q.type)) {
      const n = Number(value);
      if (!Number.isFinite(n) || (q.min !== undefined && n < q.min) || (q.max !== undefined && n > q.max)) errors.push(`${q.label} is outside the allowed range`);
    }
    if (q.type === "date" && !isValidDateAnswer(value)) errors.push(`${q.label} must be a valid date`);
    if (["select", "radio"].includes(q.type) && (typeof value !== "string" || !q.options?.includes(value))) errors.push(`${q.label} has an invalid option`);
    if (q.type === "multi_select" && (!Array.isArray(value) || value.some(v => typeof v !== "string" || !q.options?.includes(v)))) errors.push(`${q.label} has invalid options`);
    if (q.type === "checkbox" && typeof value !== "boolean") errors.push(`${q.label} must be true or false`);
    if (q.type === "boolean" && typeof value !== "boolean") errors.push(`${q.label} must be true or false`);
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}
