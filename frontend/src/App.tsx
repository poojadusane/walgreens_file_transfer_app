import { useEffect, useState } from 'react'
import LoginPage from './pages/LoginPage'
import BrowserPage from './pages/BrowserPage'
import AdminPage from './pages/AdminPage'

export interface Session {
  token: string
  user_id: string
  display_name: string
  is_admin: boolean
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [page, setPage] = useState<'browser' | 'admin'>('browser')

  useEffect(() => {
    const raw = localStorage.getItem('lb_session')
    if (raw) {
      try { setSession(JSON.parse(raw)) } catch { /* ignore */ }
    }
  }, [])

  function handleLogin(s: Session) {
    localStorage.setItem('lb_token', s.token)
    localStorage.setItem('lb_session', JSON.stringify(s))
    setSession(s)
  }

  function handleLogout() {
    localStorage.removeItem('lb_token')
    localStorage.removeItem('lb_session')
    setSession(null)
    setPage('browser')
  }

  if (!session) return <LoginPage onLogin={handleLogin} />

  const initials = session.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--db-oat-light)' }}>
      {/* navbar */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '0 32px',
        height: 56, background: 'var(--db-navy)', color: '#fff', flexShrink: 0,
      }}>
        {/* brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 'var(--r-sm)', background: 'var(--db-lava)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="white">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>Walgreens File Transfer</span>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.18)' }} />
          <span style={{ fontSize: 11, color: '#9FB4BC', fontFamily: 'var(--font-mono)' }}>Secure file transfer</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* nav tabs — admin only */}
        {session.is_admin && (
          <div style={{ display: 'flex', gap: 2 }}>
            {(['browser', 'admin'] as const).map(p => (
              <button key={p} onClick={() => setPage(p)} style={{
                color: page === p ? '#fff' : '#C7D3D8', fontSize: 13, fontWeight: 600,
                padding: '7px 14px', borderRadius: 'var(--r-sm)',
                background: page === p ? 'rgba(255,255,255,0.10)' : 'none',
              }}>
                {p === 'browser' ? 'Files' : 'Admin'}
              </button>
            ))}
          </div>
        )}

        {/* user chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--db-lava)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>
            {initials}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{session.display_name}</span>
            <span style={{ fontSize: 11, color: '#9FB4BC' }}>{session.is_admin ? 'admin' : 'user'}</span>
          </div>
        </div>

        <button onClick={handleLogout} style={{ color: '#C7D3D8', fontSize: 12, padding: '6px 8px', borderRadius: 'var(--r-sm)' }}>
          Sign out
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {page === 'browser' ? <BrowserPage session={session} /> : <AdminPage session={session} />}
      </main>
    </div>
  )
}
