import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { StudioCreateDraftInput, StudioDraftProfileMode, StudioDraftSource } from '../contracts'
import { useStudioLocale } from './i18n'
import { Button, FormField, IconButton, Input, Notice, Select } from './ui'

function CloseIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" /></svg>
}

export function CreateDraftDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose(): void
  onCreate(input: StudioCreateDraftInput): Promise<void>
}): JSX.Element {
  const { t } = useStudioLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sourceSelectRef = useRef<HTMLSelectElement>(null)
  const [sourceKind, setSourceKind] = useState<StudioDraftSource['kind']>('new')
  const [packageName, setPackageName] = useState('dsh-webui-draft')
  const [pluginDirectory, setPluginDirectory] = useState('')
  const [destinationDirectory, setDestinationDirectory] = useState('')
  const [profileMode, setProfileMode] = useState<StudioDraftProfileMode>('main-home')
  const [profileDirectory, setProfileDirectory] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open) {
      setSourceKind('new')
      setPackageName('dsh-webui-draft')
      setPluginDirectory('')
      setDestinationDirectory('')
      setProfileMode('main-home')
      setProfileDirectory('')
      setError(undefined)
      if (!dialog.open) {
        dialog.showModal()
        sourceSelectRef.current?.focus()
      }
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  const close = (): void => {
    if (!creating) onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setCreating(true)
    setError(undefined)
    try {
      const source: StudioDraftSource = sourceKind === 'new'
        ? { kind: 'new', packageName: packageName.trim() }
        : { kind: 'existing', directory: pluginDirectory.trim() }
      await onCreate({
        source,
        profileMode,
        ...(profileMode === 'custom' ? { profileDirectory: profileDirectory.trim() } : {}),
        ...(sourceKind === 'new' && destinationDirectory.trim() !== ''
          ? { destinationDirectory: destinationDirectory.trim() }
          : {}),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

  const sourceMissing = sourceKind === 'new' ? packageName.trim() === '' : pluginDirectory.trim() === ''

  return <dialog id="studio-create-draft-dialog" ref={dialogRef} className="studio-create-dialog studio-ui-root"
    aria-labelledby="studio-create-draft-title" aria-describedby="studio-create-draft-description"
    onCancel={event => {
      event.preventDefault()
      close()
    }} onClose={onClose}>
    <header className="settings-dialog-header create-dialog-header">
      <div>
        <h2 id="studio-create-draft-title">{t('draftNew')}</h2>
        <p id="studio-create-draft-description">{t('draftCreateDescription')}</p>
      </div>
      <IconButton size="small" variant="ghost" disabled={creating}
        label={t('draftCreateClose')} onClick={close}><CloseIcon /></IconButton>
    </header>
    <form className="create-dialog-form" onSubmit={event => void submit(event)}>
      <div className="create-dialog-content">
        <section className="create-dialog-section" aria-labelledby="draft-create-source-heading">
          <div className="create-dialog-section-heading">
            <h3 id="draft-create-source-heading">{t('draftCreateSourceHeading')}</h3>
            <p>{t('draftCreateSourceDescription')}</p>
          </div>
          <div className="create-dialog-fields">
            <FormField id="draft-source" label={t('sourceKind')}>
              <Select ref={sourceSelectRef} value={sourceKind}
                onChange={event => setSourceKind(event.target.value as StudioDraftSource['kind'])}>
                <option value="new">{t('sourceNew')}</option>
                <option value="existing">{t('sourceExisting')}</option>
              </Select>
            </FormField>
            {sourceKind === 'new'
              ? <>
                  <FormField id="draft-package-name" label={t('packageName')} required>
                    <Input required value={packageName} onChange={event => setPackageName(event.target.value)}
                      placeholder="dsh-webui-draft" maxLength={214} />
                  </FormField>
                  <FormField id="draft-destination-directory" label={t('draftStorage')}
                    description={t('draftStorageDescription')}>
                    <Input value={destinationDirectory} onChange={event => setDestinationDirectory(event.target.value)}
                      placeholder={t('draftStoragePlaceholder')} maxLength={4096} />
                  </FormField>
                </>
              : <FormField id="draft-plugin-directory" label={t('pluginFolder')} required
                  description={t('pluginFolderDescription')}>
                  <Input required value={pluginDirectory} onChange={event => setPluginDirectory(event.target.value)}
                    placeholder="/Users/me/.dsh/profiles/web/node_modules/my-plugin" maxLength={4096} />
                </FormField>}
          </div>
        </section>
        <section className="create-dialog-section" aria-labelledby="draft-create-profile-heading">
          <div className="create-dialog-section-heading">
            <h3 id="draft-create-profile-heading">{t('draftCreateProfileHeading')}</h3>
            <p>{t('draftCreateProfileDescription')}</p>
          </div>
          <div className="create-dialog-fields">
            <FormField id="draft-profile" label={t('profile')}>
              <Select value={profileMode} onChange={event => setProfileMode(event.target.value as StudioDraftProfileMode)}>
                <option value="main-home">{t('profileMain')}</option>
                <option value="custom">{t('profileCustom')}</option>
              </Select>
            </FormField>
            {profileMode === 'custom' && <FormField id="draft-profile-directory" label={t('profileDirectory')} required
              description={t('profileDirectoryDescription')}>
              <Input required value={profileDirectory} onChange={event => setProfileDirectory(event.target.value)}
                placeholder="/Users/me/.dsh/profiles/web" maxLength={4096} />
            </FormField>}
          </div>
        </section>
        {error !== undefined && <Notice className="create-dialog-error" tone="danger">{error}</Notice>}
      </div>
      <footer className="create-dialog-actions">
        <Button type="button" variant="ghost" disabled={creating} onClick={close}>{t('draftCreateCancel')}</Button>
        <Button type="submit" variant="primary" loading={creating} loadingLabel={t('creating')}
          disabled={sourceMissing || (profileMode === 'custom' && profileDirectory.trim() === '')}>{t('createDraft')}</Button>
      </footer>
    </form>
  </dialog>
}
