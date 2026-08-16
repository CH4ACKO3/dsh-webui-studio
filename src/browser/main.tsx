import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { initializeStudioTheme, StudioThemeProvider } from './ui'

const root = document.getElementById('root')
if (root === null) throw new Error('Harmony Studio root is missing')

initializeStudioTheme()

createRoot(root).render(<StrictMode><StudioThemeProvider><App /></StudioThemeProvider></StrictMode>)
