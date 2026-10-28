import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

/* Витрина фундамента — служебная страница, открывается по ?фундамент.
   Грузится лениво: в обычный бандл её код не попадает. */
const FoundationShowcase = lazy(() => import('./components/FoundationShowcase.jsx'))
const showFoundation = new URLSearchParams(window.location.search).has('фундамент')

/* Корень создаётся один раз: при горячей перезагрузке модуль выполняется
   заново, и повторный createRoot на том же узле роняет предупреждение. */
const container = document.getElementById('root')
const root = (window.__blogosRoot ||= ReactDOM.createRoot(container))

root.render(
  <React.StrictMode>
    {showFoundation
      ? <Suspense fallback={null}><FoundationShowcase /></Suspense>
      : <App />}
  </React.StrictMode>,
)
