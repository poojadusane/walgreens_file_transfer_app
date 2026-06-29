import { useState } from 'react'
import { api } from '../api'
import { Session } from '../App'

export default function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleSSO() {
    setLoading(true)
    setError('')
    try {
      const resp = await api.ssoLogin()
      onLogin({
        token:        resp.token,
        user_id:      resp.user.user_id,
        display_name: resp.user.display_name,
        is_admin:     resp.user.is_admin === true || (resp.user.is_admin as any) === 'true',
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(900px 500px at 50% -10%, rgba(255,95,70,0.06), transparent 60%), var(--db-oat-light)`,
      display: 'grid', placeItems: 'center', padding: '24px',
    }}>
      <div style={{ width: 400, maxWidth: '100%' }}>
        <div style={{
          background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)', padding: '40px',
        }}>
          {/* brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 'var(--r-sm)', background: 'var(--db-lava)',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
            </div>
            <span style={{ fontWeight: 700, fontSize: 17, color: 'var(--db-navy)' }}>Walgreens File Transfer</span>
          </div>

          <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: 'var(--db-navy)', letterSpacing: '-0.01em' }}>
            Sign in to transfer files
          </h2>
          <p style={{ margin: '0 0 32px', color: 'var(--db-ink-soft)', fontSize: 14, lineHeight: 1.5 }}>
            Secure access to Unity Catalog volumes — governed by your folder permissions.
          </p>

          <button
            onClick={handleSSO}
            disabled={loading}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 10, fontWeight: 700, fontSize: 15, padding: '14px 20px', borderRadius: 'var(--r-sm)',
              background: loading ? 'var(--db-gray-300)' : 'var(--db-navy)', color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer', transition: 'background .15s',
            }}
          >
            {loading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10"/>
                </svg>
                Signing in…
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="9" cy="9" r="7.5"/>
                  <path d="M9 1.5C9 1.5 6 5.5 6 9s3 7.5 3 7.5M9 1.5C9 1.5 12 5.5 12 9s-3 7.5-3 7.5M1.5 9h15"/>
                </svg>
                Sign in with SSO
              </>
            )}
          </button>

          {error && (
            <div style={{
              marginTop: 16, padding: '12px 14px', borderRadius: 'var(--r-sm)',
              background: 'var(--db-tint-rose)', border: '1px solid #f5c0bb',
              fontSize: 13, color: 'var(--db-red)', lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          <p style={{ marginTop: 20, fontSize: 11, color: 'var(--db-ink-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            Your Azure AD identity is used automatically. No password required.
          </p>
        </div>
      </div>
    </div>
  )
}
