import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type {
  StudioAutomaticPatchPlan,
  StudioAutomaticPatchRequest,
  StudioAutomaticPatchWriteResult,
  StudioDomSelection,
  StudioProjectFile,
} from '../contracts'
import { useStudioLocale } from './i18n'
import { callStudio } from './rpc'
import { Badge, Button, FormField, IconButton, Input, Notice, Select } from './ui'

function CloseIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" /></svg>
}

function identifier(value: string): string {
  const result = value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return result === '' ? 'element' : result
}

function initialSelector(selection: StudioDomSelection): string {
  const boundary = selection.boundaries[0]
  if (boundary !== undefined && selection.attributes['data-ui-surface'] === boundary.surfaceId
    && selection.attributes['data-ui-surface-path'] === JSON.stringify(boundary.path)) return '&'
  const name = selection.id === undefined
    ? `${selection.tag}${selection.classes[0] === undefined ? '' : `.${selection.classes[0]}`}`
    : `#${selection.id}`
  return `& ${name}`
}

export function AutomaticPatchDialog({ open, draftId, selection, files, onClose, onCreated, onAgent }: {
  open: boolean
  draftId?: string
  selection?: StudioDomSelection
  files: readonly StudioProjectFile[]
  onClose(): void
  onCreated(result: StudioAutomaticPatchWriteResult): Promise<void>
  onAgent(prompt: string): void
}): JSX.Element {
  const { t } = useStudioLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const component = selection?.react?.component ?? ''
  const target = selection?.react?.source?.resolved
  const boundary = selection?.boundaries[0]
  const clientFiles = useMemo(() => files.map(item => item.path).filter(path => /\.(?:[cm]?[jt]sx?)$/.test(path)
    && !path.includes('/node_modules/') && !path.startsWith('lib/')).sort((left, right) => {
      const leftClient = /(?:^|\/)client\.[^.]+$/.test(left) ? 0 : 1
      const rightClient = /(?:^|\/)client\.[^.]+$/.test(right) ? 0 : 1
      return leftClient - rightClient || left.localeCompare(right)
    }), [files])
  const [clientFile, setClientFile] = useState('')
  const [selector, setSelector] = useState('&')
  const [property, setProperty] = useState('color')
  const [value, setValue] = useState('')
  const [plan, setPlan] = useState<StudioAutomaticPatchPlan>()
  const [busy, setBusy] = useState<'analyze' | 'create'>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open) {
      setClientFile(clientFiles[0] ?? '')
      setSelector(selection === undefined ? '&' : initialSelector(selection))
      setProperty('color')
      setValue(selection?.style.color ?? '')
      setPlan(undefined)
      setError(undefined)
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) dialog.close()
  }, [open, selection])

  const request = (): StudioAutomaticPatchRequest => {
    if (draftId === undefined || target?.package === undefined || boundary === undefined || component === '' || clientFile === '') {
      throw new Error(t('automaticPatchUnavailable'))
    }
    return {
      kind: 'css-style',
      targets: [{ package: target.package, file: target.file }],
      component,
      clientFile,
      boundary,
      selector: selector.trim(),
      elementId: `auto-${identifier(component)}`,
      elementLabel: component,
      variables: [{
        id: identifier(property).replaceAll('-', '_'), label: property, property,
        control: property.includes('color') ? 'color' : /^(?:[+-]?(?:\d+\.?\d*|\.\d+))(?:px|rem|em|%|vh|vw)$/.test(value.trim()) ? 'length' : 'string',
        value: value.trim(),
      }],
    }
  }

  const analyze = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('analyze')
    setError(undefined)
    try {
      setPlan(await callStudio<StudioAutomaticPatchPlan>('studio.patches.analyzeAutomatic', { draftId, ...request() }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(undefined) }
  }

  const create = async (): Promise<void> => {
    setBusy('create')
    setError(undefined)
    try {
      const result = await callStudio<StudioAutomaticPatchWriteResult>('studio.patches.createAutomatic', { draftId, ...request() })
      await onCreated(result)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(undefined) }
  }

  const applicable = plan?.targets.reduce((sum, item) => sum + item.matches.filter(match => match.applicable).length, 0) ?? 0
  return <dialog ref={dialogRef} className="studio-create-dialog automatic-patch-dialog studio-ui-root"
    aria-labelledby="automatic-patch-title" onCancel={event => { event.preventDefault(); if (busy === undefined) onClose() }} onClose={onClose}>
    <header className="settings-dialog-header create-dialog-header">
      <div><h2 id="automatic-patch-title">{t('automaticPatchTitle')}</h2><p>{t('automaticPatchDescription')}</p></div>
      <IconButton size="small" variant="ghost" disabled={busy !== undefined} label={t('draftCreateClose')} onClick={onClose}><CloseIcon /></IconButton>
    </header>
    <form className="automatic-patch-form" onSubmit={event => void analyze(event)}>
      <div className="automatic-patch-content">
        <section className="automatic-patch-summary">
          <div><span>{t('component')}</span><code>{component || '—'}</code></div>
          <div><span>{t('targetPlugin')}</span><code>{target?.package ?? '—'}</code></div>
          <div><span>{t('source')}</span><code>{target?.file ?? '—'}</code></div>
        </section>
        <div className="automatic-patch-fields">
          <FormField id="automatic-client-file" label={t('automaticPatchClientFile')} description={t('automaticPatchClientFileDescription')}>
            <Select value={clientFile} onChange={event => { setClientFile(event.target.value); setPlan(undefined) }}>
              <option value="">{t('selectFile')}</option>
              {clientFiles.map(path => <option key={path}>{path}</option>)}
            </Select>
          </FormField>
          <FormField id="automatic-selector" label={t('styleSelector')}>
            <Input value={selector} onChange={event => { setSelector(event.target.value); setPlan(undefined) }} />
          </FormField>
          <div className="automatic-patch-declaration">
            <FormField id="automatic-property" label={t('styleProperty')}><Input value={property} onChange={event => { setProperty(event.target.value); setPlan(undefined) }} /></FormField>
            <FormField id="automatic-value" label={t('styleValue')}><Input value={value} onChange={event => { setValue(event.target.value); setPlan(undefined) }} /></FormField>
          </div>
        </div>
        {plan !== undefined && <section className="automatic-patch-analysis" aria-live="polite">
          <header><strong>{t('automaticPatchMatches')}</strong><Badge tone={plan.canApply ? 'success' : 'warning'}>{applicable}</Badge></header>
          {plan.targets.map(item => <div className="automatic-patch-target" key={`${item.package}/${item.file}`}>
            <code>{item.package} · {item.file}</code>
            {item.matches.length === 0 ? <p>{t('automaticPatchNoMatches')}</p> : item.matches.map((match, index) => <div key={index} data-applicable={match.applicable || undefined}>
              <span>{match.line}:{match.column}</span><code>{match.excerpt}</code>{match.reason === undefined ? null : <small>{match.reason}</small>}
            </div>)}
          </div>)}
        </section>}
        {error !== undefined && <Notice tone="danger">{error}</Notice>}
      </div>
      <footer className="create-dialog-actions automatic-patch-actions">
        <Button type="button" variant="ghost" disabled={busy !== undefined} onClick={() => onAgent(t('automaticPatchAgentPrompt', { component, property, value }))}>{t('automaticPatchUseAgent')}</Button>
        <span />
        <Button type="button" variant="ghost" disabled={busy !== undefined} onClick={onClose}>{t('addStyleCancel')}</Button>
        {plan === undefined
          ? <Button type="submit" variant="primary" loading={busy === 'analyze'} loadingLabel={t('automaticPatchAnalyzing')}
              disabled={clientFile === '' || selector.trim() === '' || property.trim() === '' || value.trim() === ''}>{t('automaticPatchAnalyze')}</Button>
          : <Button type="button" variant="primary" loading={busy === 'create'} loadingLabel={t('automaticPatchCreating')}
              disabled={!plan.canApply} onClick={() => void create()}>{t('automaticPatchCreate')}</Button>}
      </footer>
    </form>
  </dialog>
}
