import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '../Alert.jsx';
import { downloadFile, listFiles } from '../../services/fileFlow.js';
import { listSharedWithMe, openSharedFolder } from '../../services/shareFlow.js';
import { formatSize, saveBlob } from '../../utils/format.js';

const dateValue = (value) => value ? new Date(value).getTime() : 0;

/** Read-only shared workspace using the same folder and file presentation as My vault. */
export default function SharedWithMe() {
  const [shares, setShares] = useState(null);
  const [open, setOpen] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [error, setError] = useState(null);
  const [workingFileId, setWorkingFileId] = useState(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [viewMode, setViewMode] = useState('list');

  const load = useCallback(async () => {
    setError(null);
    try {
      setShares(await listSharedWithMe());
    } catch (err) {
      setError(err.message);
      setShares([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentId) return undefined;
    let cancelled = false;
    setFiles([]);
    setFilesLoading(true);
    listFiles(currentId)
      .then((list) => { if (!cancelled) setFiles(list); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [currentId]);

  async function onOpen(share) {
    setError(null);
    setQuery('');
    try {
      const tree = await openSharedFolder(share.folderId);
      setOpen({ share, tree });
      setCurrentId(share.folderId);
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  function onBack() {
    setOpen(null);
    setCurrentId(null);
    setFiles([]);
    setQuery('');
    load();
  }

  async function onDownload(file) {
    setWorkingFileId(file.id);
    setError(null);
    try {
      const { name, blob } = await downloadFile(file.id, currentId);
      saveBlob(name, blob);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkingFileId(null);
    }
  }

  const byId = useMemo(() => new Map((open?.tree ?? []).map((folder) => [folder.id, folder])), [open]);
  const children = useMemo(() => (open?.tree ?? [])
    .filter((folder) => folder.parentId === currentId)
    .sort((a, b) => a.name.localeCompare(b.name)), [open, currentId]);
  const trail = useMemo(() => {
    const result = [];
    for (let folder = byId.get(currentId); folder; folder = byId.get(folder.parentId)) result.unshift(folder);
    return result;
  }, [byId, currentId]);

  const visibleFolders = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...children]
      .filter((folder) => !term || folder.name.toLowerCase().includes(term))
      .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : 0);
  }, [children, query, sortBy]);

  const visibleFiles = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...files]
      .filter((file) => !term || file.name.toLowerCase().includes(term))
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'size') return b.size - a.size;
        return dateValue(b.createdAt) - dateValue(a.createdAt);
      });
  }, [files, query, sortBy]);

  if (shares === null) return <p className="explorer__status" role="status">Loading shared folders…</p>;

  if (!open) {
    const term = query.trim().toLowerCase();
    const visibleShares = shares.filter((share) =>
      !term || share.name.toLowerCase().includes(term) || share.ownerName.toLowerCase().includes(term));
    return (
      <section className="explorer explorer-content" aria-labelledby="shared-title">
        <div className="explorer-heading">
          <div>
            <p className="explorer-eyebrow">SHARED WORKSPACE</p>
            <h1 id="shared-title" className="explorer__title">Shared with me</h1>
            <p className="share__hint">Folders other people have shared with you.</p>
          </div>
        </div>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="explorer-toolbar">
          <label className="explorer-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shared folders" aria-label="Search shared folders" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </label>
          <div className="explorer-toolbar__right">
            <label className="explorer-sort">Sort by
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="name">Name</option>
              </select>
            </label>
            <div className="explorer-view-toggle" role="group" aria-label="Display mode">
              <button type="button" className={viewMode === 'grid' ? 'is-active' : ''} onClick={() => setViewMode('grid')} aria-label="Grid view" aria-pressed={viewMode === 'grid'}>▦</button>
              <button type="button" className={viewMode === 'list' ? 'is-active' : ''} onClick={() => setViewMode('list')} aria-label="List view" aria-pressed={viewMode === 'list'}>☷</button>
            </div>
          </div>
        </div>
        <div className="explorer-section-heading"><h2>Shared folders</h2><span>{visibleShares.length}</span></div>
        {visibleShares.length > 0 ? (
          <div className={`explorer-items explorer-items--${viewMode}`}>
            {visibleShares.map((share) => (
              <article className="explorer-folder-card" key={share.shareId}>
                <button type="button" className="explorer-folder-card__open" onClick={() => onOpen(share)} aria-label={`Open ${share.name}`}>
                  <span className="explorer-folder-card__icon" aria-hidden="true">📁</span>
                  <span className="explorer-folder-card__name">{share.name}</span>
                  <span className="explorer-folder-card__meta">Shared by {share.ownerName}</span>
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="explorer-inline-empty">{query ? 'No shared folders match your search.' : 'Nothing has been shared with you yet.'}</p>
        )}
        <p className="explorer-footer"><span aria-hidden="true">🔒</span> End-to-end encrypted · Shared access is read-only</p>
      </section>
    );
  }

  const currentFolder = byId.get(currentId);
  return (
    <section className="explorer explorer-content" aria-labelledby="shared-title">
      <div className="explorer-heading">
        <div>
          <p className="explorer-eyebrow">SHARED WORKSPACE</p>
          <h1 id="shared-title" className="explorer__title">{currentFolder?.name ?? open.share.name}</h1>
          <nav className="explorer__crumbs" aria-label="Folder path">
            <button type="button" className="explorer__crumb" onClick={onBack}>Shared with me</button>
            {trail.map((folder, index) => (
              <span key={folder.id}>
                <span aria-hidden="true" className="explorer__separator">/</span>
                {folder.id === currentId
                  ? <span aria-current="page">{folder.name}</span>
                  : <button type="button" className="explorer__crumb" onClick={() => setCurrentId(folder.id)}>{folder.name}</button>}
              </span>
            ))}
          </nav>
        </div>
        <span className="share__hint">Shared by {open.share.ownerName} · View and download only</span>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="explorer-toolbar">
        <label className="explorer-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder" aria-label="Search this folder" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
        </label>
        <div className="explorer-toolbar__right">
          <label className="explorer-sort">Sort by
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="name">Name</option>
              <option value="modified">Date added</option>
              <option value="size">File size</option>
            </select>
          </label>
          <div className="explorer-view-toggle" role="group" aria-label="Display mode">
            <button type="button" className={viewMode === 'grid' ? 'is-active' : ''} onClick={() => setViewMode('grid')} aria-label="Grid view" aria-pressed={viewMode === 'grid'}>▦</button>
            <button type="button" className={viewMode === 'list' ? 'is-active' : ''} onClick={() => setViewMode('list')} aria-label="List view" aria-pressed={viewMode === 'list'}>☷</button>
          </div>
        </div>
      </div>
      <div className="explorer-section-heading"><h2>Folders</h2><span>{visibleFolders.length}</span></div>
      {visibleFolders.length > 0 ? (
        <div className={`explorer-items explorer-items--${viewMode}`}>
          {visibleFolders.map((folder) => (
            <article className="explorer-folder-card" key={folder.id}>
              <button type="button" className="explorer-folder-card__open" onClick={() => { setCurrentId(folder.id); setQuery(''); }} aria-label={`Open ${folder.name}`}>
                <span className="explorer-folder-card__icon" aria-hidden="true">📁</span>
                <span className="explorer-folder-card__name">{folder.name}</span>
                <span className="explorer-folder-card__meta">Shared folder</span>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="explorer-inline-empty">{query ? 'No folders match your search.' : 'No folders in this location.'}</p>
      )}
      <div className="explorer-section-heading explorer-section-heading--files"><h2>Files</h2><span>{visibleFiles.length}</span></div>
      {filesLoading ? (
        <p className="explorer-inline-empty" role="status">Loading files…</p>
      ) : visibleFiles.length > 0 ? (
        <div className={`explorer-items explorer-items--files explorer-items--${viewMode}`}>
          {visibleFiles.map((file) => (
            <article className="explorer-file-card" key={file.id}>
              <div className="explorer-file-card__identity">
                <span className="explorer-file-card__icon" aria-hidden="true">▤</span>
                <span className="explorer-file-card__details"><strong>{file.name}</strong><small>{formatSize(file.size)} · Encrypted</small></span>
              </div>
              <div className="explorer-file-card__actions">
                <button type="button" className="explorer-icon-button" title="Download file" aria-label={`Download ${file.name}`} disabled={workingFileId === file.id} onClick={() => onDownload(file)}>↓</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="explorer-inline-empty">{query ? 'No files match your search.' : 'No files in this folder.'}</p>
      )}
      <p className="explorer-footer"><span aria-hidden="true">🔒</span> End-to-end encrypted · Shared access is read-only</p>
    </section>
  );
}
