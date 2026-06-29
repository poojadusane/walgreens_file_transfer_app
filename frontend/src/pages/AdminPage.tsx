import { useEffect, useRef, useState } from 'react'
import { api, Permission, AdminUser, Workspace, PermBody } from '../api'
import { Session } from '../App'

const VOLUMES: Record<string, string[]> = {
  'ws-alpha': ['pros_feed'], 'ws-beta': ['satr_data'],
  'ws-gamma': ['copay_reports'], 'ws-delta': ['campaign_mgmt'],
}
const FOLDERS: Record<string, string[]> = {
  pros_feed:     ['/outbound/', '/compliance/'],
  satr_data:     ['/patient_rx/', '/patient_merge/'],
  copay_reports: ['/outbound/', '/consignment/'],
  campaign_mgmt: ['/recon/', '/autofill/'],
}

const LvlBadge = ({ level }: { level: string }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, padding: '2px 8px',
    borderRadius: 'var(--r-pill)',
    background: level === 'DOWNLOAD' ? 'var(--db-tint-green)' : '#EEEDE9',
    color: level === 'DOWNLOAD' ? 'var(--db-green-700)' : 'var(--db-ink-muted)',
  }}>{level}</span>
)

export default function AdminPage({ session: _session }: { session: Session }) {
  const [perms, setPerms]       = useState<Permission[]>([])
  const [users, setUsers]       = useState<AdminUser[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading]   = useState(true)
  const [editRow, setEditRow]   = useState<Permission | null>(null)
  const [showAdd, setShowAdd]   = useState(false)
  const [newPerm, setNewPerm]   = useState<PermBody>({ user_id: '', workspace_id: '', volume: '', folder_path: '', permission: 'READ' })
  const [error, setError]       = useState('')
  const [fUser, setFUser]       = useState('')
  const [fWorkspace, setFWorkspace] = useState('')
  const [fVolume, setFVolume]   = useState('')
  const [fPermission, setFPermission] = useState('')
  const [importMsg, setImportMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await api.adminImportCsv(file)
      setImportMsg(`✓ Imported ${result.users_added} users, ${result.permissions_added} permissions`)
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      e.target.value = ''
    }
  }

  async function load() {
    setLoading(true)
    try {
      const [p, u, w] = await Promise.all([api.adminGetPermissions(), api.adminGetUsers(), api.adminGetWorkspaces()])
      setPerms(p); setUsers(u); setWorkspaces(w)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function handleAdd() {
    try {
      await api.adminAddPermission(newPerm)
      setShowAdd(false)
      setNewPerm({ user_id: '', workspace_id: '', volume: '', folder_path: '', permission: 'READ' })
      load()
    } catch (e: any) { setError(e.message) }
  }

  async function handleUpdate(p: Permission) {
    try {
      await api.adminUpdatePermission({ user_id: p.user_id, workspace_id: p.workspace_id, volume: p.volume, folder_path: p.folder_path, permission: editRow!.permission })
      setEditRow(null); load()
    } catch (e: any) { setError(e.message) }
  }

  async function handleDelete(p: Permission) {
    if (!confirm(`Remove ${p.display_name}'s access to ${p.volume}${p.folder_path}?`)) return
    try {
      await api.adminDeletePermission({ user_id: p.user_id, workspace_id: p.workspace_id, volume: p.volume, folder_path: p.folder_path })
      load()
    } catch (e: any) { setError(e.message) }
  }

  const selectStyle = {
    fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px',
    border: '1px solid var(--db-gray-300)', borderRadius: 'var(--r-sm)',
    background: '#fff', color: 'var(--db-ink)', width: '100%', cursor: 'pointer',
  }

  return (
    <div style={{ padding: '32px 40px', overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: 'var(--db-navy)', letterSpacing: '-0.01em' }}>Permission Management</h1>
          <p style={{ margin: 0, color: 'var(--db-ink-soft)', fontSize: 14 }}>Manage who can READ or DOWNLOAD each folder. Changes take effect immediately.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
          <button onClick={() => fileInputRef.current?.click()} style={{
            display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13,
            padding: '9px 16px', borderRadius: 'var(--r-sm)', background: 'var(--db-navy)', color: '#fff',
          }}>
            ↑ Import CSV
          </button>
          <button onClick={() => setShowAdd(true)} style={{
            display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13,
            padding: '9px 16px', borderRadius: 'var(--r-sm)', background: 'var(--db-lava)', color: '#fff',
          }}>
            + Add Permission
          </button>
        </div>
      </div>

      {importMsg && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, fontSize: 13, color: 'var(--db-green-700)', background: 'var(--db-tint-green)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
          {importMsg}
          <button onClick={() => setImportMsg('')} style={{ color: 'inherit', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* live-update note */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontSize: 13, color: 'var(--db-green-700)', background: 'var(--db-tint-green)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M5.5 8.5l2 2 3-4"/></svg>
        Changes to permissions take effect immediately — no redeploy required. Delta table stores full change history.
      </div>

      {/* filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {([
          { label: 'User', value: fUser, set: setFUser, opts: [...new Set(perms.map(p => p.display_name))].sort() },
          { label: 'Workspace', value: fWorkspace, set: setFWorkspace, opts: [...new Set(perms.map(p => p.workspace_name))].sort() },
          { label: 'Volume', value: fVolume, set: setFVolume, opts: [...new Set(perms.map(p => p.volume))].sort() },
          { label: 'Permission', value: fPermission, set: setFPermission, opts: ['READ', 'DOWNLOAD'] },
        ] as { label: string; value: string; set: (v: string) => void; opts: string[] }[]).map(({ label, value, set, opts }) => (
          <div key={label}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--db-navy)', marginBottom: 4 }}>{label}</label>
            <select value={value} onChange={e => set(e.target.value)}
              style={{ ...selectStyle, width: 160, background: value ? 'var(--db-navy)' : '#fff', color: value ? '#fff' : 'var(--db-ink)' }}>
              <option value="">All</option>
              {opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
        {(fUser || fWorkspace || fVolume || fPermission) && (
          <button onClick={() => { setFUser(''); setFWorkspace(''); setFVolume(''); setFPermission('') }}
            style={{ fontSize: 12, padding: '7px 12px', borderRadius: 'var(--r-sm)', color: 'var(--db-ink-soft)', border: '1px solid var(--db-line)', alignSelf: 'flex-end' }}>
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--db-tint-rose)', border: '1px solid #f5c0bb', borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--db-red)' }}>
          {error} <button onClick={() => setError('')} style={{ marginLeft: 8, color: 'inherit', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* add form */}
      {showAdd && (
        <div style={{ background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', padding: '20px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: 'var(--db-navy)' }}>Add Permission</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {[
              { label: 'User', key: 'user_id' as const, opts: users.map(u => ({ v: u.user_id, l: u.display_name })) },
              { label: 'Workspace', key: 'workspace_id' as const, opts: workspaces.map(w => ({ v: w.workspace_id, l: w.display_name })) },
              { label: 'Volume', key: 'volume' as const, opts: (VOLUMES[newPerm.workspace_id] || []).map(v => ({ v, l: v })) },
              { label: 'Folder', key: 'folder_path' as const, opts: (FOLDERS[newPerm.volume] || []).map(f => ({ v: f, l: f })) },
              { label: 'Permission', key: 'permission' as const, opts: [{ v: 'READ', l: 'READ' }, { v: 'DOWNLOAD', l: 'DOWNLOAD' }] },
            ].map(({ label, key, opts }) => (
              <div key={key}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--db-navy)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>
                <select value={newPerm[key]} style={selectStyle}
                  onChange={e => setNewPerm(prev => {
                    const next = { ...prev, [key]: e.target.value }
                    if (key === 'workspace_id') { next.volume = ''; next.folder_path = '' }
                    if (key === 'volume') { next.folder_path = '' }
                    return next
                  })}>
                  <option value="">—</option>
                  {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={handleAdd}
              disabled={!newPerm.user_id || !newPerm.workspace_id || !newPerm.volume || !newPerm.folder_path}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', background: newPerm.folder_path ? 'var(--db-navy)' : 'var(--db-gray-300)', color: '#fff' }}>
              ✓ Save
            </button>
            <button onClick={() => setShowAdd(false)} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', color: 'var(--db-ink-soft)', border: '1px solid var(--db-line)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--db-ink-muted)' }}>Loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--db-line)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <thead>
            <tr>
              {['User', 'Workspace', 'Volume', 'Folder', 'Permission', 'Granted By', ''].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fff', background: 'var(--db-navy)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.filter(p =>
              (!fUser       || p.display_name  === fUser) &&
              (!fWorkspace  || p.workspace_name === fWorkspace) &&
              (!fVolume     || p.volume         === fVolume) &&
              (!fPermission || p.permission     === fPermission)
            ).map((p, i) => {
              const isEditing = editRow?.user_id === p.user_id && editRow?.workspace_id === p.workspace_id && editRow?.volume === p.volume && editRow?.folder_path === p.folder_path
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--db-line)' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--db-navy)', fontSize: 13 }}>{p.display_name}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--db-ink-soft)', fontSize: 13 }}>{p.workspace_name}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.volume}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.folder_path}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {isEditing ? (
                      <select value={editRow!.permission} onChange={e => setEditRow({ ...editRow!, permission: e.target.value })} style={{ ...selectStyle, width: 'auto' }}>
                        <option value="READ">READ</option>
                        <option value="DOWNLOAD">DOWNLOAD</option>
                      </select>
                    ) : (
                      <LvlBadge level={p.permission} />
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--db-ink-muted)', fontSize: 12 }}>{p.granted_by}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {isEditing ? (
                        <>
                          <button onClick={() => handleUpdate(p)} style={{ color: 'var(--db-green-700)', padding: 6, borderRadius: 4 }}>✓</button>
                          <button onClick={() => setEditRow(null)} style={{ color: 'var(--db-ink-muted)', padding: 6, borderRadius: 4 }}>✕</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditRow({ ...p })} style={{ color: 'var(--db-ink-muted)', padding: 6, borderRadius: 4, display: 'grid', placeItems: 'center' }}>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
                          </button>
                          <button onClick={() => handleDelete(p)} style={{ color: 'var(--db-ink-muted)', padding: 6, borderRadius: 4, display: 'grid', placeItems: 'center' }}>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3.5h10M5 3.5V2.5h4v1M5.5 6v4M8.5 6v4M3 3.5l.8 8h6.4l.8-8"/></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {perms.filter(p =>
              (!fUser       || p.display_name  === fUser) &&
              (!fWorkspace  || p.workspace_name === fWorkspace) &&
              (!fVolume     || p.volume         === fVolume) &&
              (!fPermission || p.permission     === fPermission)
            ).length === 0 && (
              <tr><td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--db-ink-muted)' }}>
                {fUser || fWorkspace || fVolume || fPermission ? 'No permissions match the current filters.' : 'No permissions configured.'}
              </td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
