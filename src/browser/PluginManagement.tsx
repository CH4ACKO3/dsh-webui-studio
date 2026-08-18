import { type DragEvent, useEffect, useMemo, useState } from 'react'
import type {
  StudioDraftView,
  StudioHarmonyInspection,
  StudioHarmonyProfile,
  StudioHarmonyProfileUpdateResult,
  StudioPluginFiberPhase,
  StudioPluginInventoryEntry,
  StudioPluginInventorySnapshot,
} from '../contracts'
import { useStudioLocale } from './i18n'
import {
  isProfilePatchEnabled,
  isProfilePluginEnabled,
  moveProfilePatch,
  moveProfilePlugin,
  sameStringList,
  setProfilePatchEnabled,
  setProfilePluginEnabled,
} from './profile-order'
import { Badge, Button, EmptyState, Input, Notice } from './ui'
import { callStudio } from './rpc'

type ManagementView = 'plugins' | 'patches'

function GripIcon({ pinned = false }: { pinned?: boolean }): JSX.Element {
  return pinned ? <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" /></svg>
}

function inventoryTone(entry: StudioPluginInventoryEntry): 'success' | 'warning' | 'danger' | 'neutral' {
  if (!entry.enabled) return 'neutral'
  if (entry.fiberPhase === 'active') return 'success'
  if (entry.fiberPhase === 'failed') return 'danger'
  if (entry.fiberPhase === 'loading' || entry.fiberPhase === 'unloading') return 'warning'
  return 'neutral'
}

function inventoryLabel(phase: StudioPluginFiberPhase, enabled: boolean, t: ReturnType<typeof useStudioLocale>['t']): string {
  if (!enabled) return t('pluginInventoryDisabled')
  if (phase === 'active') return t('pluginInventoryActive')
  if (phase === 'failed') return t('pluginInventoryFailed')
  if (phase === 'loading') return t('pluginInventoryLoading')
  if (phase === 'unloading') return t('pluginInventoryUnloading')
  if (phase === 'pending') return t('pluginInventoryPending')
  return t('pluginInventoryIdle')
}

export function PluginManagement({ drafts, view }: {
  drafts: StudioDraftView[]
  view?: ManagementView
}): JSX.Element {
  const { t } = useStudioLocale()
  const [inventory, setInventory] = useState<StudioPluginInventoryEntry[]>([])
  const [profile, setProfile] = useState<StudioHarmonyProfile>()
  const [inspection, setInspection] = useState<StudioHarmonyInspection>({ patches: [], targets: [] })
  const [order, setOrder] = useState<string[]>([])
  const [patchOrder, setPatchOrder] = useState<string[]>([])
  const [disabled, setDisabled] = useState<string[]>([])
  const [pluginQuery, setPluginQuery] = useState('')
  const [patchQuery, setPatchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState<{ kind: 'plugin' | 'patch'; key: string }>()
  const [error, setError] = useState<string>()
  const [appliedGeneration, setAppliedGeneration] = useState<number>()
  const plugins = useMemo(() => new Map(profile?.plugins.map(plugin => [plugin.name, plugin]) ?? []), [profile])
  const patches = useMemo(() => new Map(inspection.patches.map(patch => [patch.key, patch])), [inspection])
  const managedProviders = useMemo(() => {
    const owners = new Set(inspection.patches.map(patch => patch.owner))
    return order.filter(name => name !== 'dsh-harmony' && (plugins.get(name)?.harmony === true || owners.has(name)))
  }, [inspection.patches, order, plugins])
  const ownerPatchKeys = (owner: string): string[] => patchOrder.filter(key => patches.get(key)?.owner === owner)
  const dirty = profile !== undefined && (!sameStringList(order, profile.order)
    || !sameStringList(patchOrder, profile.patchOrder) || !sameStringList(disabled, profile.disabled))

  const visibleInventory = useMemo(() => {
    const query = pluginQuery.trim().toLocaleLowerCase()
    if (query === '') return inventory
    return inventory.filter(entry => `${entry.entryId}\n${entry.moduleName}`.toLocaleLowerCase().includes(query))
  }, [inventory, pluginQuery])
  const visibleProviders = useMemo(() => {
    const query = patchQuery.trim().toLocaleLowerCase()
    if (query === '') return managedProviders
    return managedProviders.filter(name => {
      const plugin = plugins.get(name)
      return `${name}\n${plugin?.description ?? ''}\n${plugin?.version ?? ''}`.toLocaleLowerCase().includes(query)
    })
  }, [managedProviders, patchQuery, plugins])
  const visiblePatches = useMemo(() => {
    const query = patchQuery.trim().toLocaleLowerCase()
    if (query === '') return patchOrder
    return patchOrder.filter(key => {
      const patch = patches.get(key)
      return patch !== undefined && `${key}\n${patch.id}\n${patch.owner}\n${patch.kind}\n${patch.targets.flatMap(target => [target.package, ...target.files]).join('\n')}`
        .toLocaleLowerCase().includes(query)
    })
  }, [patchOrder, patchQuery, patches])

  const setLoaded = (
    nextProfile: StudioHarmonyProfile,
    nextInspection: StudioHarmonyInspection,
    nextInventory: StudioPluginInventorySnapshot,
  ): void => {
    setProfile(nextProfile)
    setInspection(nextInspection)
    setInventory(nextInventory.entries)
    setOrder(nextProfile.order)
    const known = new Set(nextProfile.patchOrder)
    setPatchOrder([...nextProfile.patchOrder, ...nextInspection.patches.map(item => item.key).filter(key => !known.has(key))])
    setDisabled(nextProfile.disabled)
  }

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const [nextProfile, nextInspection, nextInventory] = await Promise.all([
        callStudio<StudioHarmonyProfile>('studio.harmony.profile', {}),
        callStudio<StudioHarmonyInspection>('studio.harmony.inspectStable', {}),
        callStudio<StudioPluginInventorySnapshot>('studio.plugins.list', {}),
      ])
      setLoaded(nextProfile, nextInspection, nextInventory)
      setAppliedGeneration(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const apply = async (): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      const result = await callStudio<StudioHarmonyProfileUpdateResult>('studio.harmony.updateProfile', { order, patchOrder, disabled })
      const [nextInspection, nextInventory] = await Promise.all([
        callStudio<StudioHarmonyInspection>('studio.harmony.inspectStable', {}),
        callStudio<StudioPluginInventorySnapshot>('studio.plugins.list', {}),
      ])
      setLoaded(result.profile, nextInspection, nextInventory)
      setAppliedGeneration(result.generation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const enterPlugin = (event: DragEvent<HTMLElement>, name: string): void => {
    event.preventDefault()
    if (dragging?.kind !== 'plugin' || dragging.key === name) return
    setOrder(current => moveProfilePlugin(current, dragging.key, current.indexOf(name)))
  }
  const enterPatch = (event: DragEvent<HTMLElement>, key: string): void => {
    event.preventDefault()
    if (dragging?.kind !== 'patch' || dragging.key === key) return
    setPatchOrder(current => moveProfilePatch(current, dragging.key, current.indexOf(key)))
  }

  return <>
    <section id="left-sidebar-panel-plugins" role="tabpanel" hidden={view !== 'plugins'}
      aria-labelledby="left-sidebar-tab-plugins" className="left-sidebar-page plugin-management-page">
      {view === 'plugins' && <div className="plugin-management-content plugin-inventory-panel">
      <header className="profile-management-heading">
        <div><strong>{t('pluginInventoryTitle')}</strong><p>{t('pluginInventoryDescription')}</p></div>
        <Button size="small" variant="ghost" disabled={loading} onClick={() => void load()}>{t('profileRefresh')}</Button>
      </header>
      <Input className="plugin-management-search" type="search" value={pluginQuery}
        onChange={event => setPluginQuery(event.target.value)} aria-label={t('pluginInventorySearch')}
        placeholder={t('pluginInventorySearch')} />
      <div className="plugin-management-list-heading"><strong>{t('pluginInventoryList')}</strong>
        <span>{visibleInventory.length === inventory.length ? inventory.length : `${visibleInventory.length}/${inventory.length}`}</span></div>
      {loading ? <p className="profile-management-status">{t('pluginInventoryReading')}</p>
        : error !== undefined && inventory.length === 0
          ? <EmptyState title={t('pluginInventoryLoadError')} description={error}
              action={<Button size="small" onClick={() => void load()}>{t('retry')}</Button>} />
          : visibleInventory.length === 0
            ? <EmptyState title={t('pluginInventoryEmpty')} description={pluginQuery === ''
                ? t('pluginInventoryEmptyDescription') : t('pluginInventoryNoResults')} />
            : <div className="plugin-inventory-list" role="list" aria-label={t('pluginInventoryList')}>
                {visibleInventory.map((entry, index) => <article key={`${entry.entryId}:${entry.moduleName}:${index}`} role="listitem" className="plugin-inventory-row"
                  data-enabled={entry.enabled || undefined} data-phase={entry.fiberPhase ?? 'idle'}>
                  <span className="plugin-inventory-dot" aria-hidden="true" />
                  <span className="plugin-inventory-identity"><strong title={entry.entryId}>{entry.entryId}</strong>
                    <code title={entry.moduleName}>{entry.moduleName}</code></span>
                  <Badge tone={inventoryTone(entry)}>{inventoryLabel(entry.fiberPhase, entry.enabled, t)}</Badge>
                </article>)}
              </div>}
      {error !== undefined && inventory.length > 0 && <Notice tone="danger">{error}</Notice>}
      </div>}
    </section>

    <section id="left-sidebar-panel-patches" role="tabpanel" hidden={view !== 'patches'}
      aria-labelledby="left-sidebar-tab-patches" className="left-sidebar-page plugin-management-page">
      {view === 'patches' && <div className="plugin-management-content profile-management">
      <header className="profile-management-heading">
        <div><strong>{t('patchManagementTitle')}</strong><p>{t('patchManagementDescription')}</p></div>
        <Button size="small" variant="ghost" disabled={loading || saving || dirty} onClick={() => void load()}>{t('profileRefresh')}</Button>
      </header>
      <Input className="plugin-management-search" type="search" value={patchQuery}
        onChange={event => setPatchQuery(event.target.value)} aria-label={t('patchManagementSearch')}
        placeholder={t('patchManagementSearch')} />
      {loading ? <p className="profile-management-status">{t('profileLoading')}</p> : profile === undefined
        ? <EmptyState title={t('profileLoadError')} description={error}
            action={<Button size="small" onClick={() => void load()}>{t('retry')}</Button>} />
        : <>
            <div className="profile-management-scroll">
              {profile.orderViolations.length > 0 && <Notice tone="warning">{t('profileOrderWarning', { count: profile.orderViolations.length })}</Notice>}
              {profile.patchOrderViolations.length > 0 && <Notice tone="warning">{t('profilePatchOrderWarning', { count: profile.patchOrderViolations.length })}</Notice>}
              {profile.incompatibilities.length > 0 && <Notice tone="warning">{t('profileConflictWarning', { count: profile.incompatibilities.length })}</Notice>}

              <div className="plugin-management-list-heading"><strong>{t('profileProviderOrder')}</strong>
                <span>{visibleProviders.length === managedProviders.length ? managedProviders.length : `${visibleProviders.length}/${managedProviders.length}`}</span></div>
              {visibleProviders.length === 0 ? <p className="profile-management-status">{patchQuery === ''
                  ? t('patchManagementNoProviders') : t('patchManagementNoResults')}</p>
                : <div className="profile-plugin-list profile-provider-list" role="list" aria-label={t('profileProviderOrder')}
                    onDragOver={event => event.preventDefault()} onDrop={() => setDragging(undefined)}>
                    {visibleProviders.map(name => {
                      const index = order.indexOf(name)
                      const plugin = plugins.get(name)
                      const fixed = name === 'dsh-harmony'
                      const enabled = isProfilePluginEnabled(disabled, name)
                      const keys = ownerPatchKeys(name)
                      return <article role="listitem" key={name} className="profile-plugin-row" data-disabled={!enabled || undefined}
                        data-dragging={dragging?.kind === 'plugin' && dragging.key === name || undefined} draggable={!fixed && !saving}
                        onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; setDragging({ kind: 'plugin', key: name }) }}
                        onDragEnter={event => enterPlugin(event, name)} onDragEnd={() => setDragging(undefined)}>
                        <span className="profile-plugin-grip"><GripIcon pinned={fixed} /></span>
                        <span className="profile-plugin-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="profile-plugin-identity"><strong title={name}>{name}</strong><span>
                          {plugin?.version ? `v${plugin.version}` : t('profileVersionUnknown')} · {t('profilePatchCount', { count: keys.length })}
                        </span></span>
                        {fixed ? <Badge>{t('profilePinned')}</Badge> : plugin?.harmony
                          ? <button type="button" className="profile-plugin-toggle" role="switch" aria-checked={enabled} disabled={saving}
                              aria-label={enabled ? t('profileDisablePlugin') : t('profileEnablePlugin')}
                              onClick={() => setDisabled(current => setProfilePluginEnabled(current, name, !enabled))}>
                              <span aria-hidden="true" /><b>{enabled ? t('profileEnabled') : t('profileDisabled')}</b></button>
                          : <Badge>{t('profileNoPatches')}</Badge>}
                      </article>
                    })}
                  </div>}

              <div className="plugin-management-list-heading profile-patch-heading"><strong>{t('profilePatchOrder')}</strong>
                <span>{visiblePatches.length === patchOrder.length ? patchOrder.length : `${visiblePatches.length}/${patchOrder.length}`}</span></div>
              {visiblePatches.length === 0 ? <EmptyState title={patchOrder.length === 0 ? t('patchManagementEmpty') : t('patchManagementNoResults')}
                  description={patchOrder.length === 0 ? t('patchManagementEmptyDescription') : undefined} />
                : <div className="profile-plugin-list profile-patch-list" role="list" aria-label={t('profilePatchOrder')}
                    onDragOver={event => event.preventDefault()} onDrop={() => setDragging(undefined)}>
                    {visiblePatches.map(key => {
                      const patch = patches.get(key)
                      if (patch === undefined) return null
                      const patchIndex = patchOrder.indexOf(key)
                      const keys = ownerPatchKeys(patch.owner)
                      const patchEnabled = isProfilePatchEnabled(disabled, patch.owner, key)
                      const warning = profile.patchOrderViolations.some(item => item.before === key || item.after === key)
                      return <article key={key} role="listitem" className="profile-patch-row" draggable={!saving}
                        data-dragging={dragging?.kind === 'patch' && dragging.key === key || undefined}
                        data-disabled={!patchEnabled || undefined} title={patch.error}
                        onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; setDragging({ kind: 'patch', key }) }}
                        onDragEnter={event => enterPatch(event, key)} onDragEnd={() => setDragging(undefined)}>
                        <span className="profile-plugin-grip"><GripIcon /></span>
                        <span className="profile-plugin-index">{patchIndex + 1}</span>
                        <span className="profile-patch-identity"><strong title={key}>{patch.id}</strong><span>
                          {patch.owner} · {patch.kind} · {t('patchManagementMatches', { count: patch.matches })}
                        </span></span>
                        <span className="profile-patch-controls">
                          {warning && <Badge tone="warning">{t('profileConstraint')}</Badge>}
                          <Badge tone={patch.status === 'error' ? 'danger' : patch.status === 'warning' ? 'warning'
                            : patch.status === 'normal' ? 'success' : 'neutral'}>{t(patch.status === 'error' ? 'profilePatchStatusError'
                              : patch.status === 'warning' ? 'profilePatchStatusWarning' : patch.status === 'normal'
                                ? 'profilePatchStatusNormal' : 'profilePatchStatusDisabled')}</Badge>
                          <button type="button" className="profile-plugin-toggle profile-patch-toggle" role="switch"
                            aria-checked={patchEnabled} disabled={saving}
                            aria-label={patchEnabled ? t('patchManagementDisablePatch') : t('patchManagementEnablePatch')}
                            onClick={() => setDisabled(current => setProfilePatchEnabled(current, patch.owner, key, !patchEnabled, keys))}>
                            <span aria-hidden="true" /><b>{patchEnabled ? t('profileEnabled') : t('profileDisabled')}</b>
                          </button>
                        </span>
                      </article>
                    })}
                  </div>}
              {drafts.some(draft => draft.runtime.state === 'running' || draft.runtime.state === 'starting')
                && <Notice>{t('profileRunningDraftNotice')}</Notice>}
              {error !== undefined && <Notice tone="danger">{error}</Notice>}
            </div>
            <footer className="profile-management-actions"><span aria-live="polite">{dirty ? t('profileUnsaved')
              : appliedGeneration === undefined ? t('profileNoChanges') : t('profileApplied', { generation: appliedGeneration })}</span>
              <Button size="small" variant="primary" loading={saving} loadingLabel={t('profileApplying')} disabled={!dirty}
                onClick={() => void apply()}>{t('profileApply')}</Button></footer>
          </>}
      </div>}
    </section>
  </>
}
