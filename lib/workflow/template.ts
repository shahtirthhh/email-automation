export type TemplateContext = Record<string, Record<string, string>>;

/** Replaces {{scope.key}} placeholders. Unknown placeholders render as an empty string. */
export function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{\s*([\w]+)\.([\w]+)\s*\}\}/g, (_match, scope: string, key: string) => {
    return context[scope]?.[key] ?? "";
  });
}

/**
 * Renders placeholders inside the string values of an already-parsed JSON value, so
 * email content containing quotes or newlines can never break the JSON structure.
 */
export function renderJsonTemplate(value: unknown, context: TemplateContext): unknown {
  if (typeof value === "string") return renderTemplate(value, context);
  if (Array.isArray(value)) return value.map((item) => renderJsonTemplate(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderJsonTemplate(item, context)]),
    );
  }
  return value;
}
