import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

/* Витрина фундамента — служебная страница, открывается по ?фундамент.
   Грузится лениво: в обычный бандл её код не попадает. */
const FoundationShowcase = lazy(() => import('./components/FoundationShowcase.jsx'))
const showFoundation = new URLSearchParams(window.location.search).has('фундамент')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {showFoundation
      ? <Suspense fallback={null}><FoundationShowcase /></Suspense>
      : <App />}
  </React.StrictMode>,
)
