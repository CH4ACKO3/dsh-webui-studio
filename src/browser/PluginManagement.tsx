import { type DragEvent, useEffect, useMemo, useState } from 'react'
import type {
  StudioDraftView,
  StudioHarmonyProfile,
  StudioHarmonyProfileUpdateResult,
} from '../contracts'
import { useStudioLocale } from './i18n'
import { isProfilePluginEnabled, moveProfilePlugin, sameStringList, setProfilePluginEnabled } from './profile-order'
import { Badge, Button, EmptyState, Notice } from './ui'
import { callStudio } from './rpc'

function ProfileGripIcon({ pinned }: { pinned: boolean }): JSX.Element {
  return pinned
    ? <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16">
        <circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" />
        <circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" />
        <circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" />
      </svg>
}

export function PluginManagement({
  drafts,
}: {
  drafts: StudioDraftView[]
}): JSX.Element {
  const { t } = useStudioLocale()
  const [profile, setProfile] = useState<StudioHarmonyProfile>()
  const [order, setOrder] = useState<string[]>([])
  const [disabled, setDisabled] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState<string>()
  const [error, setError] = useState<string>()
  const [appliedGeneration, setAppliedGeneration] = useState<number>()
  const plugins = useMemo(() => new Map(profile?.plugins.map(plugin => [plugin.name, plugin]) ?? []), [profile])
  const dirty = profile !== undefined
    && (!sameStringList(order, profile.order) || !sameStringList(disabled, profile.disabled))

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const next = await callStudio<StudioHarmonyProfile>('studio.harmony.profile', {})
      setProfile(next)
      setOrder(next.order)
      setDisabled(next.disabled)
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
      const result = await callStudio<StudioHarmonyProfileUpdateResult>('studio.harmony.updateProfile', { order, disabled })
      setProfile(result.profile)
      setOrder(result.profile.order)
      setDisabled(result.profile.disabled)
      setAppliedGeneration(result.generation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const move = (name: string, target: number): void => {
    if (!saving) setOrder(current => moveProfilePlugin(current, name, target))
  }

  const enterRow = (event: DragEvent<HTMLElement>, name: string): void => {
    event.preventDefault()
    if (dragging === undefined || dragging === name) return
    move(dragging, order.indexOf(name))
  }

  return <div className="plugin-management-content">
    <section className="profile-management" aria-labelledby="profile-management-title">
      <header className="profile-management-heading">
        <div>
          <strong id="profile-management-title">{t('profileManagerTitle')}</strong>
          <p>{t('profileManagerDescription')}</p>
        </div>
        <Button size="small" variant="ghost" disabled={loading || saving || dirty} onClick={() => void load()}>
          {t('profileRefresh')}
        </Button>
      </header>

      {loading
        ? <p className="profile-management-status">{t('profileLoading')}</p>
        : profile === undefined
          ? <EmptyState title={t('profileLoadError')} description={error}
              action={<Button size="small" onClick={() => void load()}>{t('retry')}</Button>} />
          : <>
              {profile.orderViolations.length > 0 && <Notice tone="warning">
                {t('profileOrderWarning', { count: profile.orderViolations.length })}
              </Notice>}
              {profile.incompatibilities.length > 0 && <Notice tone="warning">
                {t('profileConflictWarning', { count: profile.incompatibilities.length })}
              </Notice>}
              <div className="profile-plugin-list" role="list" aria-label={t('profileManagerTitle')}
                onDragOver={event => event.preventDefault()} onDrop={event => {
                  event.preventDefault()
                  setDragging(undefined)
                }}>
                {order.map((name, index) => {
                  const plugin = plugins.get(name)
                  const fixed = name === 'dsh-harmony'
                  const enabled = isProfilePluginEnabled(disabled, name)
                  return <article key={name} role="listitem" tabIndex={fixed ? -1 : 0}
                    className="profile-plugin-row" data-dragging={dragging === name || undefined}
                    aria-label={fixed ? name : t('profileMovePlugin', { name })}
                    data-disabled={!enabled || undefined} draggable={!fixed && !saving}
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', name)
                      setDragging(name)
                    }}
                    onDragEnter={event => enterRow(event, name)} onDragEnd={() => setDragging(undefined)}
                    onKeyDown={event => {
                      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                      event.preventDefault()
                      move(name, index + (event.key === 'ArrowUp' ? -1 : 1))
                    }}>
                    <span className="profile-plugin-grip"><ProfileGripIcon pinned={fixed} /></span>
                    <span className="profile-plugin-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="profile-plugin-identity">
                      <strong title={name}>{name}</strong>
                      <span>{plugin?.version === undefined || plugin.version === '' ? t('profileVersionUnknown') : `v${plugin.version}`}</span>
                    </span>
                    {fixed
                      ? <Badge>{t('profilePinned')}</Badge>
                      : plugin?.harmony
                        ? <button type="button" className="profile-plugin-toggle" role="switch" aria-checked={enabled}
                            draggable={false}
                            disabled={saving} title={enabled ? t('profileDisablePlugin') : t('profileEnablePlugin')}
                            onClick={() => setDisabled(current => setProfilePluginEnabled(current, name, !enabled))}>
                            <span aria-hidden="true" /><b>{enabled ? t('profileEnabled') : t('profileDisabled')}</b>
                          </button>
                        : <Badge>{t('profileNoPatches')}</Badge>}
                  </article>
                })}
              </div>
              <footer className="profile-management-actions">
                <span aria-live="polite">{dirty ? t('profileUnsaved') : appliedGeneration === undefined
                  ? t('profileNoChanges') : t('profileApplied', { generation: appliedGeneration })}</span>
                <Button size="small" variant="primary" loading={saving} loadingLabel={t('profileApplying')}
                  disabled={!dirty} onClick={() => void apply()}>{t('profileApply')}</Button>
              </footer>
              {drafts.some(draft => draft.runtime.state === 'running' || draft.runtime.state === 'starting')
                && <Notice>{t('profileRunningDraftNotice')}</Notice>}
              {error !== undefined && <Notice tone="danger">{error}</Notice>}
            </>}
    </section>
  </div>
}
