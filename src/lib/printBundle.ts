// Zbiorczy PDF: etykiety (własne rozmiary stron) + deklaracje (A4) w JEDNYM
// pliku. Chromium (Electron 30) wspiera nazwane strony CSS (@page nazwa +
// page: nazwa), więc każda sekcja może mieć inny rozmiar strony — printToPDF
// z preferCSSPageSize skleja to w jeden dokument.

export type PdfSection = {
  widthMm: number
  heightMm: number
  bodyHtml: string
  /** ile razy powtórzyć sekcję (np. kopie etykiety) */
  repeat?: number
}

export function buildCombinedPdfHtml(sections: PdfSection[], title: string): string {
  const pageRules: string[] = []
  const bodies: string[] = []
  const seenSizes = new Map<string, string>()

  sections.forEach((s) => {
    const sizeKey = `${s.widthMm}x${s.heightMm}`
    let pageName = seenSizes.get(sizeKey)
    if (!pageName) {
      pageName = `pg${seenSizes.size}`
      seenSizes.set(sizeKey, pageName)
      pageRules.push(
        `@page ${pageName} { size: ${s.widthMm}mm ${s.heightMm}mm; margin: 0; }`,
      )
    }
    const times = Math.max(1, s.repeat ?? 1)
    for (let i = 0; i < times; i++) {
      bodies.push(
        `<div style="page: ${pageName}; width: ${s.widthMm}mm; height: ${s.heightMm}mm; overflow: hidden; break-after: page;">${s.bodyHtml}</div>`,
      )
    }
  })

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
    ${pageRules.join('\n    ')}
  </style></head><body>${bodies.join('')}</body></html>`
}
