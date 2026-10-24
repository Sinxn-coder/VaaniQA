import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MarketingHome from './MarketingHome'
import './styles.css'

const dashboardPaths = new Set(['/app', '/app/', '/dashboard', '/dashboard/'])
const page = dashboardPaths.has(window.location.pathname) ? <App /> : <MarketingHome />

createRoot(document.getElementById('root')!).render(<React.StrictMode>{page}</React.StrictMode>)
