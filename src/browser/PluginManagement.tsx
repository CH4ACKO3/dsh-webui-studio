import { type DragEvent, useEffect, useMemo, useState } from 'react'
import type { StudioDraftView, StudioHarmonyInspection, StudioHarmonyProfile, StudioHarmonyProfileUpdateResult } from '../contracts'
import { useStudioLocale } from './i18n'
import { isProfilePatchEnabled, isProfilePluginEnabled, moveProfilePatch, moveProfilePlugin, sameStringList, setProfilePatchEnabled, setProfilePluginEnabled } from './profile-order'
import { Badge, Button, EmptyState, Notice } from './ui'
import { callStudio } from './rpc'

function GripIcon({ pinned = false }: { pinned?: boolean }): JSX.Element {
  return pinned ? <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" /></svg>
}

export function PluginManagement({ drafts }: { drafts: StudioDraftView[] }): JSX.Element {
  const { t } = useStudioLocale()
  const [profile, setProfile] = useState<StudioHarmonyProfile>()
  const [inspection, setInspection] = useState<StudioHarmonyInspection>({ patches: [], targets: [] })
  const [order, setOrder] = useState<string[]>([])
  const [patchOrder, setPatchOrder] = useState<string[]>([])
  const [disabled, setDisabled] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState<{ kind: 'plugin' | 'patch'; key: string }>()
  const [error, setError] = useState<string>()
  const [appliedGeneration, setAppliedGeneration] = useState<number>()
  const plugins = useMemo(() => new Map(profile?.plugins.map(plugin => [plugin.name, plugin]) ?? []), [profile])
  const patches = useMemo(() => new Map(inspection.patches.map(patch => [patch.key, patch])), [inspection])
  const ownerPatchKeys = (owner: string): string[] => patchOrder.filter(key => patches.get(key)?.owner === owner)
  const dirty = profile !== undefined && (!sameStringList(order, profile.order) || !sameStringList(patchOrder, profile.patchOrder) || !sameStringList(disabled, profile.disabled))

  const setLoaded = (nextProfile: StudioHarmonyProfile, nextInspection: StudioHarmonyInspection): void => {
    setProfile(nextProfile); setInspection(nextInspection); setOrder(nextProfile.order)
    const known = new Set(nextProfile.patchOrder)
    setPatchOrder([...nextProfile.patchOrder, ...nextInspection.patches.map(item => item.key).filter(key => !known.has(key))])
    setDisabled(nextProfile.disabled)
  }
  const load = async (): Promise<void> => {
    setLoading(true); setError(undefined)
    try {
      const [nextProfile, nextInspection] = await Promise.all([
        callStudio<StudioHarmonyProfile>('studio.harmony.profile', {}),
        callStudio<StudioHarmonyInspection>('studio.harmony.inspectStable', {}),
      ])
      setLoaded(nextProfile, nextInspection); setAppliedGeneration(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const apply = async (): Promise<void> => {
    setSaving(true); setError(undefined)
    try {
      const result = await callStudio<StudioHarmonyProfileUpdateResult>('studio.harmony.updateProfile', { order, patchOrder, disabled })
      setLoaded(result.profile, await callStudio<StudioHarmonyInspection>('studio.harmony.inspectStable', {})); setAppliedGeneration(result.generation)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setSaving(false) }
  }
  const enterPlugin = (event: DragEvent<HTMLElement>, name: string): void => {
    event.preventDefault(); if (dragging?.kind !== 'plugin' || dragging.key === name) return
    setOrder(current => moveProfilePlugin(current, dragging.key, current.indexOf(name)))
  }
  const enterPatch = (event: DragEvent<HTMLElement>, key: string): void => {
    event.preventDefault(); if (dragging?.kind !== 'patch' || dragging.key === key) return
    setPatchOrder(current => moveProfilePatch(current, dragging.key, current.indexOf(key)))
  }

  return <div className="plugin-management-content"><section className="profile-management" aria-labelledby="profile-management-title">
    <header className="profile-management-heading"><div><strong id="profile-management-title">{t('profileManagerTitle')}</strong><p>{t('profileManagerDescription')}</p></div><Button size="small" variant="ghost" disabled={loading || saving || dirty} onClick={() => void load()}>{t('profileRefresh')}</Button></header>
    {loading ? <p className="profile-management-status">{t('profileLoading')}</p> : profile === undefined
      ? <EmptyState title={t('profileLoadError')} description={error} action={<Button size="small" onClick={() => void load()}>{t('retry')}</Button>} />
      : <>
          {profile.orderViolations.length > 0 && <Notice tone="warning">{t('profileOrderWarning', { count: profile.orderViolations.length })}</Notice>}
          {profile.patchOrderViolations.length > 0 && <Notice tone="warning">{t('profilePatchOrderWarning', { count: profile.patchOrderViolations.length })}</Notice>}
          {profile.incompatibilities.length > 0 && <Notice tone="warning">{t('profileConflictWarning', { count: profile.incompatibilities.length })}</Notice>}
          <div className="profile-plugin-list profile-provider-list" role="list" aria-label={t('profileProviderOrder')} onDragOver={event => event.preventDefault()} onDrop={() => setDragging(undefined)}>
            {order.map((name, index) => {
              const plugin = plugins.get(name); const fixed = name === 'dsh-harmony'; const enabled = isProfilePluginEnabled(disabled, name); const keys = ownerPatchKeys(name)
              return <article role="listitem" key={name} className="profile-plugin-row" data-disabled={!enabled || undefined} data-dragging={dragging?.kind === 'plugin' && dragging.key === name || undefined} draggable={!fixed && !saving}
                  onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; setDragging({ kind: 'plugin', key: name }) }} onDragEnter={event => enterPlugin(event, name)} onDragEnd={() => setDragging(undefined)}>
                  <span className="profile-plugin-grip"><GripIcon pinned={fixed} /></span><span className="profile-plugin-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="profile-plugin-identity"><strong title={name}>{name}</strong><span>{plugin?.version ? `v${plugin.version}` : t('profileVersionUnknown')} · {t('profilePatchCount', { count: keys.length })}</span></span>
                  {fixed ? <Badge>{t('profilePinned')}</Badge> : plugin?.harmony ? <button type="button" className="profile-plugin-toggle" role="switch" aria-checked={enabled} disabled={saving} onClick={() => setDisabled(current => setProfilePluginEnabled(current, name, !enabled))}><span aria-hidden="true" /><b>{enabled ? t('profileEnabled') : t('profileDisabled')}</b></button> : <Badge>{t('profileNoPatches')}</Badge>}
                </article>
            })}
          </div>
          <div className="profile-patch-heading"><strong>{t('profilePatchOrder')}</strong><span>{patchOrder.length}</span></div>
          <div className="profile-plugin-list profile-patch-list" role="list" aria-label={t('profilePatchOrder')} onDragOver={event => event.preventDefault()} onDrop={() => setDragging(undefined)}>
            {patchOrder.map((key, patchIndex) => {
              const patch = patches.get(key); if (patch === undefined) return null
              const keys = ownerPatchKeys(patch.owner)
              const patchEnabled = isProfilePatchEnabled(disabled, patch.owner, key)
              const warning = profile.patchOrderViolations.some(item => item.before === key || item.after === key)
              return <article key={key} role="listitem" className="profile-patch-row" draggable={!saving} data-dragging={dragging?.kind === 'patch' && dragging.key === key || undefined} data-disabled={!patchEnabled || undefined}
                onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; setDragging({ kind: 'patch', key }) }} onDragEnter={event => enterPatch(event, key)} onDragEnd={() => setDragging(undefined)}>
                <span className="profile-plugin-grip"><GripIcon /></span><span className="profile-plugin-index">{patchIndex + 1}</span>
                <span className="profile-patch-identity"><strong title={key}>{patch.id}</strong><span>{patch.owner} · {patch.kind}{patch.members === undefined ? '' : ` · ${t('profileCompositeMembers', { count: patch.members.length })}`}</span></span>
                {warning && <Badge tone="warning">{t('profileConstraint')}</Badge>}
                <Badge tone={patch.status === 'error' ? 'danger' : patch.status === 'warning' ? 'warning' : patch.status === 'normal' ? 'success' : 'neutral'}>{t(patch.status === 'error' ? 'profilePatchStatusError' : patch.status === 'warning' ? 'profilePatchStatusWarning' : patch.status === 'normal' ? 'profilePatchStatusNormal' : 'profilePatchStatusDisabled')}</Badge>
                <button type="button" className="profile-plugin-toggle profile-patch-toggle" role="switch" aria-checked={patchEnabled} disabled={saving} onClick={() => setDisabled(current => setProfilePatchEnabled(current, patch.owner, key, !patchEnabled, keys))}><span aria-hidden="true" /><b>{patchEnabled ? t('profileEnabled') : t('profileDisabled')}</b></button>
              </article>
            })}
          </div>
          <footer className="profile-management-actions"><span aria-live="polite">{dirty ? t('profileUnsaved') : appliedGeneration === undefined ? t('profileNoChanges') : t('profileApplied', { generation: appliedGeneration })}</span><Button size="small" variant="primary" loading={saving} loadingLabel={t('profileApplying')} disabled={!dirty} onClick={() => void apply()}>{t('profileApply')}</Button></footer>
          {drafts.some(draft => draft.runtime.state === 'running' || draft.runtime.state === 'starting') && <Notice>{t('profileRunningDraftNotice')}</Notice>}{error !== undefined && <Notice tone="danger">{error}</Notice>}
        </>}
  </section></div>
}
