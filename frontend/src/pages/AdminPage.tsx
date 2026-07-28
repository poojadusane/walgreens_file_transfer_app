import { useEffect, useRef, useState } from 'react'
import { api, Permission, AdminUser, Workspace, PermBody, Scope } from '../api'
import { Session } from '../App'

// is_admin comes back from the SQL warehouse as the STRING "true"/"false".
// A plain !! test treats "false" as truthy — normalize it here.
const isAdmin = (u?: { is_admin: unknown }): boolean =>
  !!u && String(u.is_admin).toLowerCase() === 'true'

const LvlBadge = ({ level }: { level: string }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, padding: '2px 8px',
    borderRadius: 'var(--r-pill)',
    background: level === 'DOWNLOAD' ? 'var(--db-tint-green)' : '#EEEDE9',
    color: level === 'DOWNLOAD' ? 'var(--db-green-700)' : 'var(--db-ink-muted)',
  }}>{level}</span>
)

// Searchable dropdown — type to filter options, click to select
function SearchableSelect({
  label, value, onChange, options, placeholder = 'All',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(v: string) {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 160 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--db-navy)',
        textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4,
      }}>{label}</label>
      <div
        onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '7px 10px', border: '1px solid',
          borderColor: open || value ? 'var(--db-navy)' : 'var(--db-gray-300)',
          borderRadius: 'var(--r-sm)', background: '#fff', cursor: 'pointer',
          fontSize: 13, color: value ? 'var(--db-ink)' : 'var(--db-ink-muted)',
          userSelect: 'none',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || placeholder}
        </span>
        {value
          ? <span onMouseDown={clear} style={{ fontSize: 16, lineHeight: 1, color: 'var(--db-ink-muted)', cursor: 'pointer', padding: '0 2px' }}>×</span>
          : <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="var(--db-ink-muted)" strokeWidth="1.5"><path d="M1 1l4 4 4-4"/></svg>
        }
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: '#fff', border: '1px solid var(--db-line)',
          borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)',
          zIndex: 100, maxHeight: 260, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--db-line)' }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '5px 8px', fontSize: 12, fontFamily: 'inherit',
                border: '1px solid var(--db-gray-300)', borderRadius: 4,
                outline: 'none',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div
              onMouseDown={() => select('')}
              style={{
                padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                color: 'var(--db-ink-muted)', fontStyle: 'italic',
                background: !value ? '#f4f3f0' : undefined,
              }}
            >All</div>
            {filtered.length === 0
              ? <div style={{ padding: '7px 12px', fontSize: 12, color: 'var(--db-ink-muted)' }}>No matches</div>
              : filtered.map(o => (
                <div
                  key={o}
                  onMouseDown={() => select(o)}
                  style={{
                    padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                    background: value === o ? '#EEF3FF' : undefined,
                    fontWeight: value === o ? 600 : undefined,
                  }}
                  onMouseEnter={e => { if (value !== o) e.currentTarget.style.background = '#f4f3f0' }}
                  onMouseLeave={e => { e.currentTarget.style.background = value === o ? '#EEF3FF' : '' }}
                >{o}</div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

const selectStyle = {
  fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px',
  border: '1px solid var(--db-gray-300)', borderRadius: 'var(--r-sm)',
  background: '#fff', color: 'var(--db-ink)', width: '100%', cursor: 'pointer',
}
const inputStyle = {
  fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px',
  border: '1px solid var(--db-gray-300)', borderRadius: 'var(--r-sm)',
  background: '#fff', color: 'var(--db-ink)', width: '100%', boxSizing: 'border-box' as const,
}
const fieldLabel = {
  fontSize: 11, fontWeight: 700, color: 'var(--db-navy)', display: 'block',
  marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '.04em',
}

const emptyPerm: PermBody = { user_id: '', workspace_id: '', uc_catalog: '', uc_schema: '', volume: '', folder_path: '', permission: 'READ', scope: 'FOLDER' }

const SCOPE_LABEL: Record<Scope, string> = {
  VOLUME: 'Whole volume (admin only)',
  FOLDER_TREE: 'Folder + everything under it',
  FOLDER: 'This folder only',
}

export default function AdminPage({ session: _session }: { session: Session }) {
  const [perms, setPerms]           = useState<Permission[]>([])
  const [users, setUsers]           = useState<AdminUser[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading]       = useState(true)
  const [editRow, setEditRow]       = useState<Permission | null>(null)
  const [showAdd, setShowAdd]       = useState(false)
  const [showAddUser, setShowAddUser]   = useState(false)
  const [showAddWs, setShowAddWs]       = useState(false)
  const [newPerm, setNewPerm]       = useState<PermBody>({ ...emptyPerm })
  const [newUser, setNewUser]       = useState({ display_name: '', databricks_upn: '', is_admin: false })
  const [newWs, setNewWs]           = useState({ workspace_id: '', display_name: '', host_url: '' })
  const [error, setError]           = useState('')
  const [fUser, setFUser]           = useState('')
  const [fWorkspace, setFWorkspace] = useState('')
  const [fCatalog, setFCatalog]     = useState('')
  const [fVolume, setFVolume]       = useState('')
  const [fPermission, setFPermission] = useState('')
  const [importMsg, setImportMsg]   = useState('')
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
      // VOLUME scope ignores the folder; store '/' as a canonical root.
      const body = newPerm.scope === 'VOLUME'
        ? { ...newPerm, folder_path: '/' }
        : newPerm
      await api.adminAddPermission(body)
      setShowAdd(false)
      setNewPerm({ ...emptyPerm })
      load()
    } catch (e: any) { setError(e.message) }
  }

  async function handleAddUser() {
    try {
      await api.adminAddUser(newUser)
      setShowAddUser(false)
      setNewUser({ display_name: '', databricks_upn: '', is_admin: false })
      load()
    } catch (e: any) { setError(e.message) }
  }

  async function handleAddWs() {
    try {
      await api.adminAddWorkspace(newWs)
      setShowAddWs(false)
      setNewWs({ workspace_id: '', display_name: '', host_url: '' })
      load()
    } catch (e: any) { setError(e.message) }
  }

  async function toggleAdmin(u: AdminUser) {
    try {
      await api.adminSetAdmin({ user_id: u.user_id, is_admin: !isAdmin(u) })
      load()
    } catch (e: any) { setError(e.message) }
  }

  async function handleUpdate(p: Permission) {
    try {
      await api.adminUpdatePermission({
        user_id: p.user_id, workspace_id: p.workspace_id,
        uc_catalog: p.uc_catalog, uc_schema: p.uc_schema,
        volume: p.volume, folder_path: p.folder_path,
        permission: editRow!.permission, scope: p.scope,
      })
      setEditRow(null); load()
    } catch (e: any) { setError(e.message) }
  }

  async function handleDelete(p: Permission) {
    if (!confirm(`Remove ${p.display_name}'s access to ${p.uc_catalog}.${p.uc_schema}.${p.volume}${p.folder_path}?`)) return
    try {
      await api.adminDeletePermission({
        user_id: p.user_id, workspace_id: p.workspace_id,
        uc_catalog: p.uc_catalog, uc_schema: p.uc_schema,
        volume: p.volume, folder_path: p.folder_path,
      })
      load()
    } catch (e: any) { setError(e.message) }
  }

  const userOptions      = [...new Set(perms.map(p => p.display_name))].sort()
  const workspaceOptions = [...new Set(perms.map(p => p.workspace_name))].sort()
  const catalogOptions   = [...new Set(perms.map(p => p.uc_catalog))].sort()
  const volumeOptions    = [...new Set(perms.map(p => p.volume))].sort()
  const permOptions      = ['READ', 'DOWNLOAD']

  const anyFilter = fUser || fWorkspace || fCatalog || fVolume || fPermission

  const filtered = perms.filter(p =>
    (!fUser       || p.display_name   === fUser) &&
    (!fWorkspace  || p.workspace_name === fWorkspace) &&
    (!fCatalog    || p.uc_catalog     === fCatalog) &&
    (!fVolume     || p.volume         === fVolume) &&
    (!fPermission || p.permission     === fPermission)
  )

  const btn = (bg: string) => ({
    display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13,
    padding: '9px 16px', borderRadius: 'var(--r-sm)', background: bg, color: '#fff',
  })

  return (
    <div style={{ padding: '32px 40px', overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: 'var(--db-navy)', letterSpacing: '-0.01em' }}>Permission Management</h1>
          <p style={{ margin: 0, color: 'var(--db-ink-soft)', fontSize: 14 }}>Manage who can READ or DOWNLOAD each folder. Changes take effect immediately.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
          <button onClick={() => fileInputRef.current?.click()} style={btn('var(--db-navy)')}>↑ Import CSV</button>
          <button onClick={() => { setShowAddUser(true); setShowAddWs(false); setShowAdd(false) }} style={btn('var(--db-slate)')}>+ Add User</button>
          <button onClick={() => { setShowAddWs(true); setShowAddUser(false); setShowAdd(false) }} style={btn('var(--db-slate)')}>+ Add Workspace</button>
          <button onClick={() => { setShowAdd(true); setShowAddUser(false); setShowAddWs(false) }} style={btn('var(--db-lava)')}>+ Add Permission</button>
        </div>
      </div>

      {importMsg && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, fontSize: 13, color: 'var(--db-green-700)', background: 'var(--db-tint-green)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
          {importMsg}
          <button onClick={() => setImportMsg('')} style={{ color: 'inherit', fontWeight: 700 }}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, fontSize: 13, color: 'var(--db-green-700)', background: 'var(--db-tint-green)', borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M5.5 8.5l2 2 3-4"/></svg>
        Changes take effect immediately — no redeploy required. Delta tables store full change history.
      </div>

      {error && (
        <div style={{ background: 'var(--db-tint-rose)', border: '1px solid #f5c0bb', borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--db-red)' }}>
          {error} <button onClick={() => setError('')} style={{ marginLeft: 8, color: 'inherit', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Add User panel */}
      {showAddUser && (
        <div style={{ background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', padding: '20px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: 'var(--db-navy)' }}>Add User</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={fieldLabel}>Display name</label>
              <input value={newUser.display_name} onChange={e => setNewUser({ ...newUser, display_name: e.target.value })}
                placeholder="Jane Doe" style={{ ...inputStyle, fontFamily: 'var(--font-sans)' }} />
            </div>
            <div>
              <label style={fieldLabel}>Email (Azure AD UPN)</label>
              <input value={newUser.databricks_upn} onChange={e => setNewUser({ ...newUser, databricks_upn: e.target.value })}
                placeholder="jane.doe@walgreens.com" style={inputStyle} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--db-ink)', paddingBottom: 8, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={newUser.is_admin} onChange={e => setNewUser({ ...newUser, is_admin: e.target.checked })} />
              Admin
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={handleAddUser} disabled={!newUser.databricks_upn}
              style={{ fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', background: newUser.databricks_upn ? 'var(--db-navy)' : 'var(--db-gray-300)', color: '#fff' }}>
              ✓ Save
            </button>
            <button onClick={() => setShowAddUser(false)} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', color: 'var(--db-ink-soft)', border: '1px solid var(--db-line)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Workspace panel */}
      {showAddWs && (
        <div style={{ background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', padding: '20px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: 'var(--db-navy)' }}>Add Workspace</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div>
              <label style={fieldLabel}>Databricks workspace id</label>
              <input value={newWs.workspace_id} onChange={e => setNewWs({ ...newWs, workspace_id: e.target.value })}
                placeholder="5346339970823458" style={inputStyle} />
            </div>
            <div>
              <label style={fieldLabel}>Display name</label>
              <input value={newWs.display_name} onChange={e => setNewWs({ ...newWs, display_name: e.target.value })}
                placeholder="dapdevdata-engg01" style={{ ...inputStyle, fontFamily: 'var(--font-sans)' }} />
            </div>
            <div>
              <label style={fieldLabel}>Host URL</label>
              <input value={newWs.host_url} onChange={e => setNewWs({ ...newWs, host_url: e.target.value })}
                placeholder="https://adb-....azuredatabricks.net" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={handleAddWs} disabled={!newWs.workspace_id}
              style={{ fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', background: newWs.workspace_id ? 'var(--db-navy)' : 'var(--db-gray-300)', color: '#fff' }}>
              ✓ Save
            </button>
            <button onClick={() => setShowAddWs(false)} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', color: 'var(--db-ink-soft)', border: '1px solid var(--db-line)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Permission panel */}
      {showAdd && (
        <div style={{ background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', padding: '20px', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: 'var(--db-navy)' }}>Add Permission</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div>
              <label style={fieldLabel}>User</label>
              <select value={newPerm.user_id} style={selectStyle}
                onChange={e => setNewPerm({ ...newPerm, user_id: e.target.value })}>
                <option value="">—</option>
                {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
              </select>
            </div>
            <div>
              <label style={fieldLabel}>Workspace</label>
              <select value={newPerm.workspace_id} style={selectStyle}
                onChange={e => setNewPerm({ ...newPerm, workspace_id: e.target.value })}>
                <option value="">—</option>
                {workspaces.map(w => <option key={w.workspace_id} value={w.workspace_id}>{w.display_name}</option>)}
              </select>
            </div>
            <div>
              <label style={fieldLabel}>Catalog</label>
              <input value={newPerm.uc_catalog} onChange={e => setNewPerm({ ...newPerm, uc_catalog: e.target.value })}
                placeholder="data_migration_validator_dev" style={inputStyle} />
            </div>
            <div>
              <label style={fieldLabel}>Schema</label>
              <input value={newPerm.uc_schema} onChange={e => setNewPerm({ ...newPerm, uc_schema: e.target.value })}
                placeholder="idh_app_volumes" style={inputStyle} />
            </div>
            <div>
              <label style={fieldLabel}>Volume</label>
              <input value={newPerm.volume} onChange={e => setNewPerm({ ...newPerm, volume: e.target.value })}
                placeholder="external_vol_idh" style={inputStyle} />
            </div>
            <div>
              <label style={fieldLabel}>Folder</label>
              <input value={newPerm.folder_path} onChange={e => setNewPerm({ ...newPerm, folder_path: e.target.value })}
                placeholder="/idh-test/" style={inputStyle} />
            </div>
            <div>
              <label style={fieldLabel}>Permission</label>
              <select value={newPerm.permission} style={selectStyle}
                onChange={e => setNewPerm({ ...newPerm, permission: e.target.value })}>
                <option value="READ">READ</option>
                <option value="DOWNLOAD">DOWNLOAD</option>
              </select>
            </div>
            <div>
              <label style={fieldLabel}>Scope</label>
              <select value={newPerm.scope} style={selectStyle}
                onChange={e => setNewPerm({ ...newPerm, scope: e.target.value as Scope })}>
                <option value="FOLDER">{SCOPE_LABEL.FOLDER}</option>
                <option value="FOLDER_TREE">{SCOPE_LABEL.FOLDER_TREE}</option>
                {/* VOLUME only offered when the selected user is an admin */}
                {isAdmin(users.find(u => u.user_id === newPerm.user_id)) && (
                  <option value="VOLUME">{SCOPE_LABEL.VOLUME}</option>
                )}
              </select>
            </div>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--db-ink-muted)' }}>
            {newPerm.scope === 'VOLUME'
              ? <>Whole-volume access — the folder is ignored; the user can browse and download everything in <code>{newPerm.volume || 'the volume'}</code>. Admins only.</>
              : newPerm.scope === 'FOLDER_TREE'
              ? <>Grants <code>{newPerm.folder_path || '/folder/'}</code> and every subfolder beneath it. Use leading + trailing slashes.</>
              : <>Grants only the files directly in <code>{newPerm.folder_path || '/folder/'}</code>. Use leading + trailing slashes.</>
            }
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={handleAdd}
              disabled={!newPerm.user_id || !newPerm.workspace_id || !newPerm.uc_catalog || !newPerm.uc_schema || !newPerm.volume || (newPerm.scope !== 'VOLUME' && !newPerm.folder_path)}
              style={{ fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', background: (newPerm.uc_catalog && newPerm.uc_schema && newPerm.volume && (newPerm.scope === 'VOLUME' || newPerm.folder_path)) ? 'var(--db-navy)' : 'var(--db-gray-300)', color: '#fff' }}>
              ✓ Save
            </button>
            <button onClick={() => setShowAdd(false)} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 'var(--r-sm)', color: 'var(--db-ink-soft)', border: '1px solid var(--db-line)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Users summary with admin toggle */}
      {users.length > 0 && (
        <details style={{ marginBottom: 20, background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-sm)' }}>
          <summary style={{ cursor: 'pointer', padding: '12px 16px', fontWeight: 700, fontSize: 14, color: 'var(--db-navy)' }}>
            Users ({users.length})
          </summary>
          <div style={{ borderTop: '1px solid var(--db-line)' }}>
            {users.map((u, i) => (
              <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--db-line)', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: 'var(--db-navy)', minWidth: 160 }}>{u.display_name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--db-ink-soft)', flex: 1 }}>{u.databricks_upn}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--db-ink-soft)' }}>
                  <input type="checkbox" checked={isAdmin(u)} onChange={() => toggleAdmin(u)} />
                  Admin
                </label>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* searchable filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <SearchableSelect label="User"       value={fUser}       onChange={setFUser}       options={userOptions} />
        <SearchableSelect label="Workspace"  value={fWorkspace}  onChange={setFWorkspace}  options={workspaceOptions} />
        <SearchableSelect label="Catalog"    value={fCatalog}    onChange={setFCatalog}    options={catalogOptions} />
        <SearchableSelect label="Volume"     value={fVolume}     onChange={setFVolume}     options={volumeOptions} />
        <SearchableSelect label="Permission" value={fPermission} onChange={setFPermission} options={permOptions} />
        {anyFilter && (
          <button
            onClick={() => { setFUser(''); setFWorkspace(''); setFCatalog(''); setFVolume(''); setFPermission('') }}
            style={{ fontSize: 12, padding: '7px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--db-line)', color: 'var(--db-ink-soft)', alignSelf: 'flex-end' }}
          >
            Clear filters
          </button>
        )}
        <span style={{ alignSelf: 'flex-end', fontSize: 12, color: 'var(--db-ink-muted)', paddingBottom: 8 }}>
          {anyFilter ? `${filtered.length} of ${perms.length}` : `${perms.length} total`}
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--db-ink-muted)' }}>Loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--db-line)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <thead>
            <tr>
              {['User', 'Email', 'Workspace', 'Catalog', 'Schema', 'Volume', 'Folder', 'Permission', 'Scope', 'Granted By', ''].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fff', background: 'var(--db-navy)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const isEditing = editRow?.user_id === p.user_id && editRow?.workspace_id === p.workspace_id &&
                editRow?.uc_catalog === p.uc_catalog && editRow?.uc_schema === p.uc_schema &&
                editRow?.volume === p.volume && editRow?.folder_path === p.folder_path
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--db-line)', background: i % 2 === 0 ? '#fff' : '#fafaf9' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--db-navy)', fontSize: 13, whiteSpace: 'nowrap' }}>{p.display_name}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--db-ink-soft)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{p.databricks_upn || ''}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--db-ink-soft)', fontSize: 13 }}>{p.workspace_name}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.uc_catalog}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.uc_schema}</td>
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
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--r-pill)',
                      background: p.scope === 'VOLUME' ? '#FDE8D4' : p.scope === 'FOLDER_TREE' ? '#E4ECFB' : '#EEEDE9',
                      color: p.scope === 'VOLUME' ? '#9A5B12' : p.scope === 'FOLDER_TREE' ? '#2C4C86' : 'var(--db-ink-muted)',
                      whiteSpace: 'nowrap',
                    }}>
                      {p.scope === 'VOLUME' ? 'Volume' : p.scope === 'FOLDER_TREE' ? 'Folder+sub' : 'Folder'}
                    </span>
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
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ padding: '48px', textAlign: 'center', color: 'var(--db-ink-muted)' }}>
                {anyFilter ? 'No permissions match the selected filters.' : 'No permissions configured.'}
              </td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
