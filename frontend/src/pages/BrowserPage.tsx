import { useEffect, useState } from 'react'
import { api, Workspace, VolumeGroup, FileEntry, DirEntry, Scope } from '../api'
import { Session } from '../App'

type View = 'workspaces' | 'volumes' | 'files'

interface Preview { filename: string; headers: string[]; rows: string[][]; truncated: boolean }

function parseCSV(content: string): { headers: string[]; rows: string[][]; truncated: boolean } {
  const lines = content.trim().split('\n').filter(l => l.trim())
  if (!lines.length) return { headers: [], rows: [], truncated: false }
  const parse = (line: string) => line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  const headers = parse(lines[0])
  const all = lines.slice(1).map(parse)
  return { headers, rows: all.slice(0, 200), truncated: all.length > 200 }
}

const LvlBadge = ({ level }: { level: string }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, padding: '2px 8px',
    borderRadius: 'var(--r-pill)',
    background: level === 'DOWNLOAD' ? 'var(--db-tint-green)' : '#EEEDE9',
    color: level === 'DOWNLOAD' ? 'var(--db-green-700)' : 'var(--db-ink-muted)',
  }}>{level}</span>
)

const Cbox = ({ on }: { on: boolean }) => (
  <span style={{
    width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${on ? 'var(--db-lava)' : 'var(--db-gray-400)'}`,
    display: 'inline-grid', placeItems: 'center', background: on ? 'var(--db-lava)' : '#fff',
    flexShrink: 0,
  }}>
    {on && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M2 6l3 3 5-5"/></svg>}
  </span>
)

function fmtSize(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function BrowserPage({ session }: { session: Session }) {
  const [view, setView] = useState<View>('workspaces')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWs, setActiveWs] = useState('')
  const [volumes, setVolumes] = useState<VolumeGroup[]>([])
  const [activeVol, setActiveVol] = useState('')
  const [activeCat, setActiveCat] = useState('')
  const [activeSch, setActiveSch] = useState('')
  const [activeFolder, setActiveFolder] = useState('')
  const [activeScope, setActiveScope] = useState<Scope>('FOLDER')
  const [rootFolder, setRootFolder] = useState('')   // the granted folder we entered at
  const [files, setFiles] = useState<FileEntry[]>([])
  const [dirs, setDirs] = useState<DirEntry[]>([])
  const [permission, setPermission] = useState<'READ' | 'DOWNLOAD'>('READ')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // load workspaces
  useEffect(() => {
    api.getWorkspaces()
      .then(ws => setWorkspaces(ws))
      .catch(e => setError(e.message))
  }, [])

  // load volumes when workspace selected
  useEffect(() => {
    if (!activeWs) return
    api.getVolumes(activeWs).then(vols => {
      setVolumes(vols)
      setActiveVol('')
      setActiveCat('')
      setActiveSch('')
      setActiveFolder('')
      setFiles([])
    }).catch(e => setError(e.message))
  }, [activeWs])

  // load contents when folder selected.
  // FOLDER scope → flat file list. FOLDER_TREE / VOLUME → browse (dirs + files),
  // so the user can navigate into discovered subfolders.
  useEffect(() => {
    if (!activeWs || !activeCat || !activeSch || !activeVol || !activeFolder) return
    setLoading(true)
    setFiles([])
    setDirs([])
    setSelected(new Set())
    setPreview(null)
    setError('')
    const navigable = activeScope === 'VOLUME' || activeScope === 'FOLDER_TREE'
    const p = navigable
      ? api.browse(activeWs, activeCat, activeSch, activeVol, activeFolder)
          .then(resp => { setFiles(resp.files); setDirs(resp.dirs); setPermission(resp.permission) })
      : api.listFiles(activeWs, activeCat, activeSch, activeVol, activeFolder)
          .then(resp => { setFiles(resp.files); setDirs([]); setPermission(resp.permission) })
    p.catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [activeWs, activeCat, activeSch, activeVol, activeFolder, activeScope])

  async function openPreview(filename: string) {
    setPreviewLoading(true)
    setPreview(null)
    try {
      const resp = await api.previewFile(activeWs, activeCat, activeSch, activeVol, activeFolder, filename)
      const { headers, rows, truncated } = parseCSV(resp.content)
      setPreview({ filename, headers, rows, truncated })
    } catch (e: any) { setError(e.message) }
    finally { setPreviewLoading(false) }
  }

  function pickWorkspace(wsId: string) {
    setActiveWs(wsId)
    setView('volumes')
  }

  // Enter a specific granted folder. For VOLUME scope the granted folder is the
  // volume root ('/'); for FOLDER_TREE we start at the granted folder and can go
  // deeper; for FOLDER we just show that folder's files.
  function enterGrant(vol: VolumeGroup, folder: string, scope: Scope) {
    setActiveCat(vol.uc_catalog)
    setActiveSch(vol.uc_schema)
    setActiveVol(vol.volume)
    setActiveScope(scope)
    const start = scope === 'VOLUME' ? '/' : folder
    setRootFolder(start)
    setActiveFolder(start)
    setView('files')
  }

  function pickFolder(folder: string) {
    setActiveFolder(folder)
  }

  // navigate into a discovered subfolder (tree/volume scopes only)
  function enterDir(path: string) {
    setActiveFolder(path)
  }

  // go up one level, but never above the granted root
  function goUpFolder() {
    if (activeFolder === rootFolder) return
    const trimmed = activeFolder.replace(/\/$/, '')
    const parent = trimmed.slice(0, trimmed.lastIndexOf('/') + 1)
    setActiveFolder(parent.length >= rootFolder.length ? parent : rootFolder)
  }

  const canNavigate = activeScope === 'VOLUME' || activeScope === 'FOLDER_TREE'

  function goTo(v: View, ws = '', vol = '', folder = '') {
    if (v === 'workspaces') { setActiveWs(''); setActiveVol(''); setActiveCat(''); setActiveSch(''); setActiveFolder(''); }
    if (v === 'volumes') { setActiveVol(''); setActiveCat(''); setActiveSch(''); setActiveFolder(''); }
    if (v === 'files') setActiveFolder(folder)
    setView(v)
  }

  const activeWsData = workspaces.find(w => w.workspace_id === activeWs)
  const activeVolData = volumes.find(v => v.volume === activeVol && v.uc_catalog === activeCat && v.uc_schema === activeSch)
  // permission comes from the server response for the current folder (authoritative)
  const isDownload = permission === 'DOWNLOAD'

  async function handleDownload(filename?: string) {
    setDownloading(true)
    try {
      let resp: Response
      if (filename) {
        resp = await api.downloadFile(activeWs, activeCat, activeSch, activeVol, activeFolder, filename)
      } else {
        resp = await api.downloadZip(activeWs, activeCat, activeSch, activeVol, activeFolder, Array.from(selected))
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || `files_${Date.now()}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setError(e.message) }
    finally { setDownloading(false) }
  }

  const allSelected = files.length > 0 && files.every(f => selected.has(f.name))
  function toggleFile(name: string) {
    setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(files.map(f => f.name)))
  }

  const selFiles = files.filter(f => selected.has(f.name))
  const selSize = selFiles.reduce((a, b) => a + (b.size || 0), 0)

  return (
    <div style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
      {/* breadcrumbs */}
      {view !== 'workspaces' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, fontSize: 13 }}>
          <button onClick={() => goTo('workspaces')} style={{ color: 'var(--db-ink-soft)', fontWeight: 600, padding: '3px 4px', borderRadius: 4 }}>
            Workspaces
          </button>
          {activeWs && (
            <>
              <span style={{ color: 'var(--db-gray-400)' }}>/</span>
              {view === 'files'
                ? <button onClick={() => goTo('volumes')} style={{ color: 'var(--db-ink-soft)', fontWeight: 600, padding: '3px 4px', borderRadius: 4 }}>{activeWsData?.display_name}</button>
                : <span style={{ color: 'var(--db-navy)', fontWeight: 700 }}>{activeWsData?.display_name}</span>
              }
            </>
          )}
          {view === 'files' && activeVol && (
            <>
              <span style={{ color: 'var(--db-gray-400)' }}>/</span>
              <span style={{ color: 'var(--db-navy)', fontWeight: 700 }}>{activeVol}</span>
            </>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--db-tint-rose)', border: '1px solid #f5c0bb', borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--db-red)' }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, color: 'inherit', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* WORKSPACES VIEW */}
      {view === 'workspaces' && (
        <>
          <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: 'var(--db-navy)', letterSpacing: '-0.01em' }}>Your workspaces</h1>
          <p style={{ margin: '0 0 24px', color: 'var(--db-ink-soft)', fontSize: 16 }}>Only workspaces where you hold at least one folder permission appear here.</p>
          {workspaces.length === 0 && !error && (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--db-ink-muted)' }}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ marginBottom: 12 }}>
                <rect x="4" y="8" width="32" height="24" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M4 14h32" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <div>No workspaces available. Contact your platform admin.</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {workspaces.map(ws => (
              <button key={ws.workspace_id} onClick={() => pickWorkspace(ws.workspace_id)} style={{
                textAlign: 'left', background: '#fff', border: '1px solid var(--db-line)',
                borderRadius: 'var(--r-md)', padding: '20px', display: 'flex', gap: 16,
                alignItems: 'flex-start', boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
                transition: 'box-shadow .15s, transform .15s, border-color .15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-md)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-sm)'; (e.currentTarget as HTMLButtonElement).style.transform = 'none' }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 'var(--r-sm)', background: 'var(--db-oat-light)', border: '1px solid var(--db-line)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="var(--db-navy-700)" strokeWidth="1.5">
                    <rect x="1" y="5" width="20" height="15" rx="2"/>
                    <path d="M7 5V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--db-navy)', marginBottom: 3 }}>{ws.display_name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--db-ink-muted)', marginBottom: 8, wordBreak: 'break-all' }}>
                    {ws.host_url?.replace('https://', '')}
                  </div>
                </div>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--db-gray-400)" strokeWidth="1.5"><path d="M7 4l5 5-5 5"/></svg>
              </button>
            ))}
          </div>
        </>
      )}

      {/* VOLUMES VIEW */}
      {view === 'volumes' && (
        <>
          <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: 'var(--db-navy)', letterSpacing: '-0.01em' }}>{activeWsData?.display_name}</h1>
          <p style={{ margin: '0 0 24px', color: 'var(--db-ink-soft)', fontSize: 16 }}>Unity Catalog volumes you can access in this workspace.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {volumes.map(vol => (
              <div key={`${vol.uc_catalog}.${vol.uc_schema}.${vol.volume}`} style={{ background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', padding: '16px 20px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 'var(--r-sm)', background: 'var(--db-oat-light)', border: '1px solid var(--db-line)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="var(--db-navy-700)" strokeWidth="1.5">
                      <path d="M3 7h16M3 11h16M3 15h16M7 3v16M15 3v16" opacity=".4"/>
                      <rect x="1" y="1" width="20" height="20" rx="2"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--db-navy)' }}>{vol.volume}</div>
                    <div style={{ fontSize: 11, color: 'var(--db-ink-muted)', fontFamily: 'var(--font-mono)' }}>{vol.uc_catalog}.{vol.uc_schema}</div>
                    <div style={{ fontSize: 12, color: 'var(--db-ink-muted)' }}>{vol.folders.length} folder{vol.folders.length !== 1 ? 's' : ''} granted</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {vol.folders.map(f => (
                    <button key={`${f.scope}:${f.folder}`} onClick={() => enterGrant(vol, f.folder, f.scope)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--db-line)',
                      background: 'var(--db-oat-light)', cursor: 'pointer', textAlign: 'left',
                      transition: 'border-color .15s',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={f.permission === 'DOWNLOAD' ? 'var(--db-green-700)' : 'var(--db-slate)'} strokeWidth="1.5">
                          <path d="M1 4.5A1.5 1.5 0 0 1 2.5 3h2l1.5 2H12a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z"/>
                        </svg>
                        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--db-ink)' }}>
                          {f.scope === 'VOLUME' ? '(entire volume)' : f.folder}
                        </span>
                        {f.scope === 'FOLDER_TREE' && <span style={{ fontSize: 10, color: 'var(--db-ink-muted)' }}>+ subfolders</span>}
                      </span>
                      <LvlBadge level={f.permission} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* FILES VIEW */}
      {view === 'files' && activeVolData && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--db-navy)', letterSpacing: '-0.01em' }}>{activeVol}</h1>
                <LvlBadge level={permission} />
              </div>
              {canNavigate ? (
                /* current path + up button for navigable (tree / volume) grants */
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  {activeFolder !== rootFolder && (
                    <button onClick={goUpFolder} style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                      borderRadius: 'var(--r-sm)', fontSize: 12, border: '1px solid var(--db-line)',
                      background: '#fff', color: 'var(--db-ink-soft)', cursor: 'pointer',
                    }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 2L3 6l4 4"/></svg>
                      Up
                    </button>
                  )}
                  <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--db-ink-soft)' }}>
                    {activeScope === 'VOLUME' ? `/Volumes/${activeCat}/${activeSch}/${activeVol}` : ''}{activeFolder}
                  </span>
                </div>
              ) : (
                /* single-folder tabs for FOLDER-scope grants in this volume */
                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                  {activeVolData.folders.filter(f => f.scope === 'FOLDER').map(f => (
                    <button key={f.folder} onClick={() => pickFolder(f.folder)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                      borderRadius: 'var(--r-sm)', fontSize: 13, fontFamily: 'var(--font-mono)',
                      border: `1px solid ${activeFolder === f.folder ? 'var(--db-navy-700)' : 'var(--db-line)'}`,
                      background: activeFolder === f.folder ? 'var(--db-navy)' : '#fff',
                      color: activeFolder === f.folder ? '#fff' : 'var(--db-ink)',
                      cursor: 'pointer',
                    }}>
                      {f.folder}
                      <LvlBadge level={f.permission} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* READ banner */}
          {!isDownload && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, background: 'var(--db-oat-light)',
              border: '1px solid var(--db-line)', borderLeft: '3px solid var(--db-slate)',
              borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: 16,
              fontSize: 13, color: 'var(--db-ink-soft)',
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--db-slate)" strokeWidth="1.5">
                <rect x="3" y="7" width="10" height="8" rx="1.5"/><path d="M5 7V5a3 3 0 1 1 6 0v2"/>
              </svg>
              <span><strong style={{ color: 'var(--db-navy)' }}>Read-only access.</strong> You can view filenames, sizes and dates. Downloading is disabled — ask an admin for DOWNLOAD permission.</span>
            </div>
          )}

          {/* download toolbar */}
          {isDownload && files.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={() => handleDownload()} disabled={selected.size === 0 || downloading} style={{
                display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13,
                padding: '9px 18px', borderRadius: 'var(--r-sm)',
                background: selected.size > 0 && !downloading ? 'var(--db-lava)' : 'var(--db-gray-300)',
                color: '#fff', cursor: selected.size > 0 && !downloading ? 'pointer' : 'not-allowed',
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v9M5 8l3 3 3-3M2 13h12"/>
                </svg>
                {downloading ? 'Downloading…' : selected.size > 0 ? `Download selected (${selected.size})` : 'Download selected'}
              </button>
            </div>
          )}

          {/* subfolders (navigable grants only) */}
          {canNavigate && dirs.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {dirs.map(d => (
                <button key={d.path} onClick={() => enterDir(d.path)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--db-line)', background: '#fff',
                  cursor: 'pointer', fontSize: 13,
                }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--db-gold, #C79A3A)" strokeWidth="1.5">
                    <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2.5A1 1 0 0 1 1.5 12z"/>
                  </svg>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--db-navy)' }}>{d.name}/</span>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--db-ink-muted)' }}>Loading files…</div>
          ) : files.length === 0 && dirs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--db-ink-muted)', background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)' }}>This folder is empty.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--db-line)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'var(--db-oat-light)', borderBottom: '1px solid var(--db-line)' }}>
                  {isDownload && (
                    <th style={{ width: 44, padding: '11px 16px', textAlign: 'left' }}>
                      <div onClick={toggleAll} style={{ cursor: 'pointer', display: 'inline-block' }}>
                        <Cbox on={allSelected} />
                      </div>
                    </th>
                  )}
                  {!isDownload && <th style={{ width: 44, padding: '11px 16px' }} />}
                  <th style={{ textAlign: 'left', padding: '11px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--db-ink-muted)' }}>Name</th>
                  <th style={{ textAlign: 'right', padding: '11px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--db-ink-muted)', width: 120 }}>Size</th>
                </tr>
              </thead>
              <tbody>
                {files.map(f => {
                  const on = selected.has(f.name)
                  const isPreviewing = preview?.filename === f.name
                  return (
                    <tr key={f.name} style={{ borderTop: '1px solid var(--db-line)', background: isPreviewing ? '#EEF2FB' : on ? 'rgba(158,214,196,0.28)' : undefined, transition: 'background .1s' }}>
                      {isDownload ? (
                        <td style={{ padding: '12px 16px', cursor: 'pointer' }} onClick={() => toggleFile(f.name)}>
                          <Cbox on={on} />
                        </td>
                      ) : (
                        <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--db-gray-400)' }}>
                          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="2" y="6" width="11" height="9" rx="1.5"/><path d="M4 6V4.5a3.5 3.5 0 1 1 7 0V6"/>
                          </svg>
                        </td>
                      )}
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          onClick={() => isPreviewing ? setPreview(null) : openPreview(f.name)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, color: 'var(--db-navy-700)', background: 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                            <path d="M10 2H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-5z"/><path d="M10 2v5h5"/>
                          </svg>
                          {f.name}
                        </button>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--db-ink-muted)' }}>
                        {fmtSize(f.size)}
                      </td>
                    </tr>
                  )
                })}
                {files.length === 0 && !loading && (
                  <tr><td colSpan={isDownload ? 3 : 3} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--db-ink-muted)' }}>No files in this folder</td></tr>
                )}
              </tbody>
            </table>
          )}

          {/* preview panel */}
          {previewLoading && (
            <div style={{ marginTop: 16, padding: '24px', background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', textAlign: 'center', color: 'var(--db-ink-muted)', fontSize: 13 }}>
              Loading preview…
            </div>
          )}
          {preview && !previewLoading && (
            <div style={{ marginTop: 16, background: '#fff', border: '1px solid var(--db-line)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--db-navy)', color: '#fff' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-mono)' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-5z"/><path d="M8 2v5h5"/></svg>
                  {preview.filename}
                  {preview.truncated && <span style={{ fontSize: 11, fontWeight: 400, color: '#9FB4BC', fontFamily: 'var(--font-sans)' }}>— showing first 200 rows</span>}
                </span>
                <button onClick={() => setPreview(null)} style={{ color: '#9FB4BC', fontSize: 18, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}>×</button>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
                {preview.headers.length === 0 ? (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--db-ink-muted)', fontSize: 13 }}>File is empty or not a CSV.</div>
                ) : (
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                    <thead style={{ position: 'sticky', top: 0 }}>
                      <tr>
                        {preview.headers.map((h, i) => (
                          <th key={i} style={{ padding: '8px 12px', textAlign: 'left', background: '#F5F4F1', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--db-ink-soft)', borderBottom: '1px solid var(--db-line)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#FAFAF8' }}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ padding: '7px 12px', borderBottom: '1px solid var(--db-line)', color: 'var(--db-ink)', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--db-ink-muted)', borderTop: '1px solid var(--db-line)', fontFamily: 'var(--font-mono)' }}>
                {preview.rows.length} row{preview.rows.length !== 1 ? 's' : ''} × {preview.headers.length} column{preview.headers.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          {/* selection bar */}
          {isDownload && selFiles.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, padding: '12px 16px',
              background: 'var(--db-navy)', borderRadius: 'var(--r-md)', color: '#fff',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                <strong style={{ color: 'var(--db-gold)' }}>{selFiles.length}</strong> file{selFiles.length !== 1 ? 's' : ''} selected
              </span>
              <span style={{ fontSize: 12, color: '#9FB4BC', fontFamily: 'var(--font-mono)' }}>{fmtSize(selSize)}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: '#9FB4BC', fontFamily: 'var(--font-mono)' }}>
                {selFiles.length > 1 ? `→ ${activeFolder.replace(/\//g, '').replace('-', '_')}_download.zip` : '→ direct stream'}
              </span>
              <button onClick={() => handleDownload()} disabled={downloading} style={{
                display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13,
                padding: '8px 16px', borderRadius: 'var(--r-sm)', background: 'var(--db-lava)', color: '#fff',
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v9M5 8l3 3 3-3M2 13h12"/>
                </svg>
                {downloading ? 'Downloading…' : 'Download'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
