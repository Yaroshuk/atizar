import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Landing } from './Landing/Landing'
import { Demo } from './Demo'

// `/` = the marketing landing; `/demo` = the live board. One SPA, one origin — the server's
// static fallback (staticDir seam) serves index.html for both so /demo deep-links directly.
export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path='/' element={<Landing />} />
      <Route path='/demo' element={<Demo />} />
    </Routes>
  </BrowserRouter>
)
