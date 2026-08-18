import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type {
  StudioAutomaticPatchPlan,
  StudioAutomaticPatchRequest,
  StudioAutomaticPatchWriteResult,
  StudioDomSelection,
  StudioElementSnapshot,
  StudioProjectFile,
} from '../contracts'
import { useStudioLocale } from './i18n'
import { callStudio } from './rpc'
import { Badge, Button, FormField, IconButton, Input, Notice, SegmentedControl, Select, Textarea } from './ui'

type AutomaticPatchMode = 'style' | 'content'

function CloseIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" /></svg>
}

function identifier(value: string): string {
  const result = value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return result === '' ? 'element' : result
}

export function automaticPatchScope(selection?: StudioDomSelection): {
  boundary: { surfaceId: string; path: string[] }
  targetSelector?: string
} | undefined {
  if (selection === undefined) return undefined
  const boundary = selection.boundaries[0]
  if (boundary !== undefined) return { boundary }
  const targetSelector = selection.id !== undefined ? `[id=${JSON.stringify(selection.id)}]`
    : selection.classes[0] !== undefined ? `${selection.tag}[class~=${JSON.stringify(selection.classes[0])}]`
      : selection.selector?.trim()
  if (targetSelector === undefined || targetSelector === '') return undefined
  return { boundary: { surfaceId: 'dsh-studio-auto', path: [targetSelector] }, targetSelector }
}

function initialSelector(selection: StudioDomSelection): string {
  const boundary = selection.boundaries[0]
  if (boundary === undefined) return '&'
  if (boundary !== undefined && selection.attributes['data-ui-surface'] === boundary.surfaceId
    && selection.attributes['data-ui-surface-path'] === JSON.stringify(boundary.path)) return '&'
  const name = selection.id === undefined
    ? `${selection.tag}${selection.classes[0] === undefined ? '' : `.${selection.classes[0]}`}`
    : `#${selection.id}`
  return `& ${name}`
}

export function AutomaticPatchDialog({ open, draftId, selection, files, existingElement, allowCss, onClose, onCreated, onAgent }: {
  open: boolean
  draftId?: string
  selection?: StudioDomSelection
  files: readonly StudioProjectFile[]
  existingElement?: StudioElementSnapshot
  allowCss: boolean
  onClose(): void
  onCreated(result: StudioAutomaticPatchWriteResult): Promise<void>
  onAgent(prompt: string): void
}): JSX.Element {
  const { t } = useStudioLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const component = selection?.react?.component ?? ''
  const target = selection?.react?.source?.resolved
  const scope = automaticPatchScope(selection)
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
  const [mode, setMode] = useState<AutomaticPatchMode>('style')
  const [originalText, setOriginalText] = useState('')
  const [replacementText, setReplacementText] = useState('')
  const [plan, setPlan] = useState<StudioAutomaticPatchPlan>()
  const [busy, setBusy] = useState<'analyze' | 'create'>()
  const [error, setError] = useState<string>()
  const cssAvailable = allowCss && component !== '' && target?.package !== undefined && scope !== undefined && clientFiles.length > 0
  const contentAvailable = target?.package !== undefined && scope !== undefined && clientFiles.length > 0
    && (selection?.text.trim() ?? '') !== ''

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open) {
      setClientFile(clientFiles[0] ?? '')
      setSelector(selection === undefined ? '&' : initialSelector(selection))
      setProperty('color')
      setValue(selection?.style.color ?? '')
      setMode(cssAvailable ? 'style' : 'content')
      setOriginalText(selection?.text ?? '')
      setReplacementText(selection?.text ?? '')
      setPlan(undefined)
      setError(undefined)
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) dialog.close()
  }, [open, selection, cssAvailable])

  const request = (): StudioAutomaticPatchRequest => {
    if (draftId === undefined || target?.package === undefined) {
      throw new Error(t('automaticPatchUnavailable'))
    }
    if (mode === 'content') {
      if (!contentAvailable || scope === undefined || clientFile === '' || originalText.trim() === '' || replacementText === originalText) {
        throw new Error(t('automaticPatchContentUnavailable'))
      }
      const identity = component === '' ? selection?.tag ?? 'Element' : component
      return {
        kind: 'replace-string',
        targets: [{ package: target.package, file: target.file }],
        text: originalText,
        replacement: replacementText,
        clientFile,
        boundary: scope.boundary,
        ...(scope.targetSelector === undefined ? {} : { targetSelector: scope.targetSelector }),
        selector: selector.trim(),
        elementId: existingElement?.element.id ?? `auto-${identifier(identity)}`,
        elementLabel: existingElement?.element.label ?? identity,
        ...(existingElement === undefined ? {} : { elementSourceFile: existingElement.element.source.file }),
      }
    }
    if (!cssAvailable || scope === undefined || clientFile === '') throw new Error(t('automaticPatchUnavailable'))
    return {
      kind: 'css-style',
      targets: [{ package: target.package, file: target.file }],
      component,
      clientFile,
      boundary: scope.boundary,
      ...(scope.targetSelector === undefined ? {} : { targetSelector: scope.targetSelector }),
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
        <SegmentedControl className="automatic-patch-mode" label={t('automaticPatchMode')} value={mode}
          options={[
            { value: 'style', label: t('automaticPatchModeStyle'), disabled: !cssAvailable },
            { value: 'content', label: t('automaticPatchModeContent'), disabled: !contentAvailable },
          ]} onChange={next => { setMode(next); setPlan(undefined); setError(undefined) }} />
        <div className="automatic-patch-fields">
          {mode === 'style' ? <>
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
          </> : <div className="automatic-patch-content-fields">
            <FormField id="automatic-original-text" label={t('automaticPatchOriginalText')} description={t('automaticPatchOriginalTextDescription')}>
              <Textarea value={originalText} onChange={event => { setOriginalText(event.target.value); setPlan(undefined) }} />
            </FormField>
            <FormField id="automatic-replacement-text" label={t('automaticPatchReplacementText')}>
              <Textarea autoFocus value={replacementText} onChange={event => { setReplacementText(event.target.value); setPlan(undefined) }} />
            </FormField>
          </div>}
        </div>
        {plan !== undefined && <section className="automatic-patch-analysis" aria-live="polite">
          <header><strong>{t(plan.request.kind === 'css-style' ? 'automaticPatchMatches' : 'automaticPatchContentMatches')}</strong>
            <Badge tone={plan.canApply ? 'success' : 'warning'}>{applicable}</Badge></header>
          {plan.targets.map(item => <div className="automatic-patch-target" key={`${item.package}/${item.file}`}>
            <code>{item.package} · {item.file}</code>
            {item.matches.length === 0 ? <p>{t(plan.request.kind === 'css-style' ? 'automaticPatchNoMatches' : 'automaticPatchContentNoMatches')}</p>
              : item.matches.map((match, index) => <div key={index} data-applicable={match.applicable || undefined}>
              <span>{match.line}:{match.column}</span><code>{match.excerpt}</code>{match.reason === undefined ? null : <small>{match.reason}</small>}
            </div>)}
          </div>)}
        </section>}
        {error !== undefined && <Notice tone="danger">{error}</Notice>}
      </div>
      <footer className="create-dialog-actions automatic-patch-actions">
        <Button type="button" variant="ghost" disabled={busy !== undefined} onClick={() => onAgent(mode === 'style'
          ? t('automaticPatchAgentPrompt', { component, property, value })
          : t('automaticPatchAgentContentPrompt', { original: originalText, replacement: replacementText }))}>{t('automaticPatchUseAgent')}</Button>
        <span />
        <Button type="button" variant="ghost" disabled={busy !== undefined} onClick={onClose}>{t('addStyleCancel')}</Button>
        {plan === undefined
          ? <Button type="submit" variant="primary" loading={busy === 'analyze'} loadingLabel={t('automaticPatchAnalyzing')}
              disabled={mode === 'style' ? clientFile === '' || selector.trim() === '' || property.trim() === '' || value.trim() === ''
                : originalText.trim() === '' || replacementText === originalText}>{t('automaticPatchAnalyze')}</Button>
          : <Button type="button" variant="primary" loading={busy === 'create'} loadingLabel={t('automaticPatchCreating')}
              disabled={!plan.canApply} onClick={() => void create()}>{t('automaticPatchCreate')}</Button>}
      </footer>
    </form>
  </dialog>
}
