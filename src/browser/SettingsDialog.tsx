import { useEffect, useRef, useState } from 'react'
import { isStudioLocale, STUDIO_LANGUAGES, useStudioLocale } from './i18n'
import { IconButton, Select, ThemeSwitcher } from './ui'

type SettingsSection = 'general' | 'appearance'

function CloseIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" /></svg>
}

export function SettingsIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20">
    <path d="M7.5 3.8h9M3.5 3.8h1.4M12.5 10h4M3.5 10h6.4M9.5 16.2h7M3.5 16.2h3.4" />
    <circle cx="6.2" cy="3.8" r="1.3" /><circle cx="11.2" cy="10" r="1.3" /><circle cx="8.2" cy="16.2" r="1.3" />
  </svg>
}

function GeneralIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20">
    <path d="M4 5.5h12M4 10h12M4 14.5h12" />
    <circle cx="7" cy="5.5" r="1.4" /><circle cx="13" cy="10" r="1.4" /><circle cx="8.5" cy="14.5" r="1.4" />
  </svg>
}

function AppearanceIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="3.2" />
    <path d="M10 2.8v1.4M10 15.8v1.4M2.8 10h1.4M15.8 10h1.4M4.9 4.9l1 1M14.1 14.1l1 1M15.1 4.9l-1 1M5.9 14.1l-1 1" />
  </svg>
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element {
  const { locale, setLocale, t } = useStudioLocale()
  const [section, setSection] = useState<SettingsSection>('general')
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia('(max-width: 560px)').matches)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 560px)')
    const update = (): void => setCompactNavigation(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return <dialog ref={dialogRef} className="studio-settings-dialog studio-ui-root"
    aria-labelledby="studio-settings-title" onCancel={event => {
      event.preventDefault()
      onClose()
    }} onClose={onClose} onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }}>
    <header className="settings-dialog-header">
      <h2 id="studio-settings-title">{t('settings')}</h2>
      <IconButton size="small" variant="ghost" label={t('settingsClose')} onClick={onClose}>
        <CloseIcon />
      </IconButton>
    </header>
    <div className="settings-dialog-layout">
      <nav className="settings-dialog-nav" role="tablist"
        aria-orientation={compactNavigation ? 'horizontal' : 'vertical'} aria-label={t('settingsNavigation')}>
        {([
          ['general', t('settingsGeneral'), <GeneralIcon key="general" />],
          ['appearance', t('settingsAppearance'), <AppearanceIcon key="appearance" />],
        ] as const).map(([value, label, icon], index) => <button key={value} id={`settings-tab-${value}`}
          type="button" role="tab" aria-selected={section === value} aria-controls={`settings-panel-${value}`}
          tabIndex={section === value ? 0 : -1} onClick={() => setSection(value)} onKeyDown={event => {
            const previousKey = compactNavigation ? 'ArrowLeft' : 'ArrowUp'
            const nextKey = compactNavigation ? 'ArrowRight' : 'ArrowDown'
            if (event.key !== previousKey && event.key !== nextKey && event.key !== 'Home' && event.key !== 'End') return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1
              : (index + (event.key === nextKey ? 1 : -1) + 2) % 2
            const nextSection: SettingsSection = next === 0 ? 'general' : 'appearance'
            setSection(nextSection)
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          }}>
          {icon}<span>{label}</span>
        </button>)}
      </nav>
      <div className="settings-dialog-content">
        {section === 'general' && <section id="settings-panel-general" role="tabpanel"
          aria-labelledby="settings-tab-general" className="settings-page">
          <div className="settings-page-heading">
            <h3>{t('settingsGeneral')}</h3>
          </div>
          <div className="settings-row">
            <div className="settings-copy">
              <strong>{t('settingsLanguage')}</strong>
              <p>{t('settingsLanguageDescription')}</p>
            </div>
            <Select className="settings-choice settings-language-select" value={locale}
              aria-label={t('settingsLanguageControl')} onChange={event => {
                if (isStudioLocale(event.target.value)) setLocale(event.target.value)
              }}>
              {STUDIO_LANGUAGES.map(language => <option key={language.locale} value={language.locale}>
                {language.nativeName}
              </option>)}
            </Select>
          </div>
        </section>}
        {section === 'appearance' && <section id="settings-panel-appearance" role="tabpanel"
          aria-labelledby="settings-tab-appearance" className="settings-page">
          <div className="settings-page-heading">
            <h3>{t('settingsAppearance')}</h3>
          </div>
          <div className="settings-row">
            <div className="settings-copy">
              <strong>{t('settingsTheme')}</strong>
              <p>{t('settingsThemeDescription')}</p>
            </div>
            <ThemeSwitcher className="settings-choice" label={t('settingsTheme')} labels={{
              light: t('themeLight'),
              system: t('themeSystem'),
              dark: t('themeDark'),
            }} />
          </div>
        </section>}
      </div>
    </div>
  </dialog>
}
