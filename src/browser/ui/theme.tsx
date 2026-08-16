import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export const STUDIO_THEME_STORAGE_KEY = 'dsh-webui-studio.theme'

export type StudioThemePreference = 'light' | 'dark' | 'system'
export type StudioResolvedTheme = Exclude<StudioThemePreference, 'system'>

export interface StudioThemeState {
  preference: StudioThemePreference
  resolved: StudioResolvedTheme
  setPreference(preference: StudioThemePreference): void
}

interface ThemeRoot {
  dataset: DOMStringMap
  style: Pick<CSSStyleDeclaration, 'colorScheme'>
}

const StudioThemeContext = createContext<StudioThemeState | undefined>(undefined)

export function isStudioThemePreference(value: unknown): value is StudioThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readStudioTheme(storage: Pick<Storage, 'getItem'>): StudioThemePreference {
  const stored = storage.getItem(STUDIO_THEME_STORAGE_KEY)
  return isStudioThemePreference(stored) ? stored : 'system'
}

export function resolveStudioTheme(
  preference: StudioThemePreference,
  systemPrefersDark: boolean,
): StudioResolvedTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference
}

export function applyStudioTheme(root: ThemeRoot, theme: StudioResolvedTheme): void {
  root.dataset.studioTheme = theme
  root.style.colorScheme = theme
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Apply the saved theme before React mounts to avoid a light-theme flash. */
export function initializeStudioTheme(): StudioThemePreference {
  const preference = readStudioTheme(window.localStorage)
  applyStudioTheme(document.documentElement, resolveStudioTheme(preference, systemPrefersDark()))
  return preference
}

export function StudioThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [preference, setPreferenceState] = useState<StudioThemePreference>(() => readStudioTheme(window.localStorage))
  const [darkSystemTheme, setDarkSystemTheme] = useState(systemPrefersDark)
  const resolved = resolveStudioTheme(preference, darkSystemTheme)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const changed = (event: MediaQueryListEvent): void => setDarkSystemTheme(event.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])

  useEffect(() => applyStudioTheme(document.documentElement, resolved), [resolved])

  const setPreference = useCallback((next: StudioThemePreference): void => {
    window.localStorage.setItem(STUDIO_THEME_STORAGE_KEY, next)
    setPreferenceState(next)
  }, [])

  const value = useMemo<StudioThemeState>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  )

  return <StudioThemeContext.Provider value={value}>{children}</StudioThemeContext.Provider>
}

export function useStudioTheme(): StudioThemeState {
  const value = useContext(StudioThemeContext)
  if (value === undefined) throw new Error('useStudioTheme must be used inside StudioThemeProvider')
  return value
}
