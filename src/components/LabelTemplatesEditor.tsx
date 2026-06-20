import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { renderLabelHtml, LABEL_FIELDS, type LabelTemplate } from '../lib/labelRender'
import type { Order, ToastVariant } from '../types'

type Props = {
  isManager: boolean
  pushToast: (message: string, variant: ToastVariant) => void
}

const CATEGORIES = ['STA', 'Disting', 'ST', 'Techniczne', 'Bastion', 'DrzwiWewnetrzne'] as const

// Przykładowe zlecenie do podglądu (żeby placeholdery coś pokazały)
const SAMPLE_ORDER = {
  id: 9999, order_number: '1234', company: 'PRZYKŁAD Sp. z o.o.', model: 'FIGARO 02',
  wing_color: 'ANTRACYT', frame_color: 'ANTRACYT', width: '90', height: '2000',
  system: 'NORMAL', direction: 'PRAWE', order_date: '2026-06-17', notes: 'Przykład',
  category: 'STA',
} as unknown as Order

const emptyForm = (category: string) => ({
  id: null as number | null,
  category,
  name: '',
  html: '<div style="padding:4mm;font-size:10pt">\n  <div style="font-weight:bold;font-size:14pt">{{nr_zlecenia}}</div>\n  <div>{{firma}}</div>\n  <div>{{model}} — {{kolor}}</div>\n  <div>{{wymiar}} {{kierunek}}</div>\n  <div style="position:absolute;right:4mm;top:4mm;width:20mm;height:20mm">{{qr}}</div>\n</div>',
  width_mm: 100,
  height_mm: 50,
  is_default: false,
})

export default function LabelTemplatesEditor({ isManager, pushToast }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [category, setCategory] = useState<string>('STA')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm('STA'))
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('label_templates').select('*').order('category').order('name')
    if (!mountedRef.current) return
    setTemplates((data ?? []) as LabelTemplate[])
    setLoading(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => { mountedRef.current = false }
  }, [load])

  // live podgląd
  useEffect(() => {
    let cancelled = false
    const tpl: LabelTemplate = {
      id: form.id ?? 0, category: form.category, name: form.name,
      html: form.html, width_mm: form.width_mm, height_mm: form.height_mm, is_default: form.is_default,
    }
    void renderLabelHtml(tpl, { ...SAMPLE_ORDER, category: form.category }).then((html) => {
      if (!cancelled) setPreview(html)
    })
    return () => { cancelled = true }
  }, [form])

  const templatesForCat = useMemo(
    () => templates.filter((t) => t.category === category),
    [templates, category],
  )

  const editTemplate = (t: LabelTemplate) => {
    setCategory(t.category)
    setForm({ id: t.id, category: t.category, name: t.name, html: t.html, width_mm: Number(t.width_mm), height_mm: Number(t.height_mm), is_default: t.is_default })
  }

  const handleSave = async () => {
    if (!form.name.trim()) { pushToast('Podaj nazwę szablonu', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        category: form.category, name: form.name.trim(), html: form.html,
        width_mm: form.width_mm, height_mm: form.height_mm, is_default: form.is_default,
        updated_at: new Date().toISOString(),
      }
      // jeśli ustawiamy domyślny — zdejmij domyślny z innych w tej kategorii
      if (form.is_default) {
        await supabase.from('label_templates').update({ is_default: false }).eq('category', form.category)
      }
      let error
      if (form.id != null) {
        ;({ error } = await supabase.from('label_templates').update(payload).eq('id', form.id))
      } else {
        ;({ error } = await supabase.from('label_templates').insert([payload]))
      }
      if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
      pushToast('Szablon zapisany', 'success')
      setForm(emptyForm(form.category))
      await load()
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const handleDelete = async (t: LabelTemplate) => {
    if (!window.confirm(`Usunąć szablon „${t.name}"?`)) return
    const { error } = await supabase.from('label_templates').delete().eq('id', t.id)
    if (error) { pushToast(`Błąd: ${error.message}`, 'error'); return }
    pushToast('Usunięto', 'success')
    if (form.id === t.id) setForm(emptyForm(category))
    await load()
  }

  return (
    <div className="label-tpl-editor">
      <details className="label-tpl-help">
        <summary>ℹ️ Jak tworzyć etykiety?</summary>
        <div className="label-tpl-help-body">
          <p><strong>Etykieta to zwykły HTML z inline CSS.</strong> Wpisujesz kod, a program podstawia dane zlecenia i drukuje w zadanym rozmiarze.</p>
          <ul>
            <li><strong>Wymiary (mm)</strong> = fizyczny rozmiar etykiety na rolce. Stylach używaj jednostek <code>mm</code> (np. <code>font-size:4mm</code>, <code>width:20mm</code>).</li>
            <li><strong>Pola w podwójnych klamrach</strong> podstawiają dane zlecenia, np. <code>{'{{nr_zlecenia}}'}</code>, <code>{'{{firma}}'}</code>. Pełna lista pod edytorem.</li>
            <li><strong>{'{{qr}}'}</strong> wstawia kod QR (z ID zlecenia). Umieść go w pojemniku o ustalonym rozmiarze, np.:<br />
              <code>{'<div style="width:18mm;height:18mm">{{qr}}</div>'}</code></li>
            <li><strong>Pozycjonowanie:</strong> używaj <code>position:absolute</code> względem etykiety (np. QR w rogu: <code>position:absolute;right:3mm;top:3mm</code>).</li>
            <li>Po prawej masz <strong>podgląd na żywo</strong> z przykładowymi danymi — zmienia się gdy edytujesz.</li>
            <li>Możesz mieć kilka szablonów na kategorię; <strong>⭐ domyślny</strong> jest wybierany automatycznie przy druku.</li>
          </ul>
          <p className="label-tpl-help-example"><strong>Przykład minimalny:</strong></p>
          <pre>{`<div style="padding:3mm;font-family:Arial">
  <div style="font-size:6mm;font-weight:bold">{{nr_zlecenia}}</div>
  <div style="font-size:3.5mm">{{firma}}</div>
  <div style="font-size:3.5mm">{{model}} — {{kolor}}</div>
  <div style="font-size:3.5mm">{{wymiar}} {{kierunek}}</div>
  <div style="position:absolute;right:3mm;top:3mm;width:18mm;height:18mm">{{qr}}</div>
</div>`}</pre>
        </div>
      </details>

      <div className="components-filter-pills">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`alerts-filter-pill ${category === c ? 'alerts-filter-pill--active' : ''}`} onClick={() => { setCategory(c); setForm(emptyForm(c)) }}>
            {c}
          </button>
        ))}
      </div>

      <div className="label-tpl-list">
        {loading ? <span className="no-results">Ładowanie…</span> : templatesForCat.length === 0 ? (
          <span className="no-results">Brak szablonów dla {category}.</span>
        ) : templatesForCat.map((t) => (
          <div key={t.id} className="label-tpl-row">
            <button type="button" className="label-tpl-name" onClick={() => editTemplate(t)}>
              {t.name} ({t.width_mm}×{t.height_mm}mm){t.is_default ? ' ⭐' : ''}
            </button>
            {isManager && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleDelete(t)}><Trash2 size={14} /></button>
            )}
          </div>
        ))}
      </div>

      {isManager && (
        <div className="label-tpl-form">
          <div className="label-tpl-form-fields">
            <div className="label-tpl-form-top">
              <input type="text" placeholder="Nazwa szablonu" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <label>Szer (mm) <input type="number" value={form.width_mm} onChange={(e) => setForm((p) => ({ ...p, width_mm: Number(e.target.value) || 0 }))} style={{ width: 70 }} /></label>
              <label>Wys (mm) <input type="number" value={form.height_mm} onChange={(e) => setForm((p) => ({ ...p, height_mm: Number(e.target.value) || 0 }))} style={{ width: 70 }} /></label>
              <label className="label-tpl-default"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} /> domyślny</label>
            </div>
            <textarea className="label-tpl-html" value={form.html} onChange={(e) => setForm((p) => ({ ...p, html: e.target.value }))} rows={12} spellCheck={false} />
            <div className="label-tpl-placeholders">
              <span className="label-tpl-ph-title">Dostępne pola (kliknij, by wstawić):</span>
              <div className="label-tpl-ph-grid">
                {LABEL_FIELDS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="label-tpl-ph-chip"
                    title={`Wstaw ${f.label}`}
                    onClick={() => setForm((p) => ({ ...p, html: `${p.html}{{${f.key}}}` }))}
                  >
                    <code>{`{{${f.key}}}`}</code> <span className="label-tpl-ph-label">{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="label-tpl-actions">
              <button type="button" className="btn btn-success" disabled={saving} onClick={() => void handleSave()}>
                <Plus size={14} /> {form.id != null ? 'Zapisz zmiany' : 'Dodaj szablon'}
              </button>
              {form.id != null && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(emptyForm(category))}>Nowy</button>}
            </div>
          </div>
          <div className="label-tpl-preview">
            <span className="order-field-label-text">Podgląd ({form.width_mm}×{form.height_mm}mm — rozmiar rzeczywisty)</span>
            <div className="label-tpl-preview-frame">
              <iframe
                title="Podgląd szablonu"
                srcDoc={preview}
                style={{
                  width: `${form.width_mm}mm`,
                  height: `${form.height_mm}mm`,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  display: 'block',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
