import { z } from "zod";
import type { ParameterDef } from "../config/types.js";

/** パラメータ定義からZodスキーマを動的生成 */
function buildSchema(params: ParameterDef[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of params) {
    let field: z.ZodTypeAny;
    switch (p.type) {
      case "string":
        field = z.string();
        break;
      case "number":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
    }
    if (!p.required) {
      field = field.optional();
      if (p.default !== undefined) field = field.default(p.default);
    }
    shape[p.name] = field;
  }
  return z.object(shape);
}

/** テンプレートJSON内の {{param}} を置換 */
export function renderTemplate(
  template: Record<string, unknown>,
  params: ParameterDef[],
  values: Record<string, unknown>
): Record<string, unknown> {
  // Validate
  const schema = buildSchema(params);
  const validated = schema.parse(values);

  // Deep clone and replace
  const json = JSON.stringify(template);
  const rendered = json.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = validated[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
  return JSON.parse(rendered) as Record<string, unknown>;
}
