import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StudioLocaleProvider } from './i18n'
import './styles.css'
import { initializeStudioTheme, StudioThemeProvider } from './ui'

const root = document.getElementById('root')
if (root === null) throw new Error('Harmony Studio root is missing')

initializeStudioTheme()

createRoot(root).render(
  <StrictMode>
    <StudioThemeProvider>
      <StudioLocaleProvider>
        <App />
      </StudioLocaleProvider>
    </StudioThemeProvider>
  </StrictMode>,
)
