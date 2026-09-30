import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { applyTheme, loadThemeKey } from './ui/theme/theme'

applyTheme(loadThemeKey()) // до первого кадра, чтобы не мигала светлая тема

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
