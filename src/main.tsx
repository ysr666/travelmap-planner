import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppearanceProvider } from './components/AppearanceController.tsx'
import { applyStoredAppearance } from './lib/appearance.ts'
import App from './App.tsx'
import { AppAuthGate } from './components/auth/AppAuthGate.tsx'

applyStoredAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider>
      <AppAuthGate>
        <App />
      </AppAuthGate>
    </AppearanceProvider>
  </StrictMode>,
)
