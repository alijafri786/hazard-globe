export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export const DISCLAIMER =
  'Hazard Globe is not an official warning service: alerts may be delayed or missed. ' +
  'Always follow your national meteorological and civil protection agencies.'

/** A small standalone page for the links in emails (confirm, unsubscribe). `body` is trusted HTML. */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Hazard Globe</title>
<style>
  :root { color-scheme: light dark; --accent: #7c5cff; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: #0b1220; color: #e8edf6; }
  main { max-width: 440px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  button { font: inherit; color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer; }
  small { display: block; margin-top: 24px; color: #94a0b8; font-size: 13px; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1>${body}<small>${escapeHtml(DISCLAIMER)}</small></main></body>
</html>`
}
