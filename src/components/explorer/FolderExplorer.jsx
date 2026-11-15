import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '../Alert.jsx';
import Button from '../Button.jsx';
import TextField from '../TextField.jsx';
import SharePanel from './SharePanel.jsx';
import { FOLDER_NAME_MAX, createSubfolder, getVaultFolderId, listFolders } from '../../services/folderFlow.js';
import { formatSize, saveBlob } from '../../utils/format.js';
import { MAX_FILE_BYTES, deleteFile, downloadFile, listFiles, uploadFile } from '../../services/fileFlow.js';

const dateValue = (value) => value ? new Date(value).getTime() : 0;

/** Secure file explorer. Plain names and ids stay in the browser; encryption remains in the flow services. */
export default function FolderExplorer() {
  const [folders, setFolders] = useState(null);
  const [vaultId, setVaultId] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [name, setName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(null);
  const [workingFileId, setWorkingFileId] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [viewMode, setViewMode] = useState('grid');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [id, all] = await Promise.all([getVaultFolderId(), listFolders()]);
      setVaultId(id);
      setCurrentId((cur) => cur ?? id);
      setFolders(all);
    } catch (err) {
      setError(err.message);
      setFolders((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentId || folders === null) return undefined;
    let cancelled = false;
    setFiles([]);
    listFiles(currentId)
      .then((list) => !cancelled && setFiles(list))
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [currentId, folders]);

  const byId = useMemo(() => new Map((folders ?? []).map((folder) => [folder.id, folder])), [folders]);
  const children = useMemo(() => (folders ?? [])
    .filter((folder) => folder.parentId === currentId)
    .sort((a, b) => a.name.localeCompare(b.name)), [folders, currentId]);
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

  async function onCreate(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createSubfolder(name, currentId);
      setFolders((current) => [...(current ?? []), created]);
      setName('');
      setShowCreate(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onPickFiles(event) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    setError(null);
    for (const file of picked) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name} is larger than ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
        continue;
      }
      try {
        setProgress({ name: file.name, done: 0, total: 1 });
        const saved = await uploadFile(file, currentId, {
          onProgress: (done, total) => setProgress({ name: file.name, done, total }),
        });
        setFiles((current) => [...current, { ...saved, createdAt: new Date().toISOString() }]);
      } catch (err) {
        setError(err.message);
      }
    }
    setProgress(null);
  }

  async function onDownload(file) {
    setWorkingFileId(file.id);
    setError(null);
    try {
      const { name: fileName, blob } = await downloadFile(file.id, currentId);
      saveBlob(fileName, blob);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkingFileId(null);
    }
  }

  async function onDelete(file) {
    if (!window.confirm(`Delete ${file.name}? This cannot be undone.`)) return;
    setWorkingFileId(file.id);
    setError(null);
    try {
      await deleteFile(file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkingFileId(null);
    }
  }

  function renderFolderTree(parentId, depth = 0) {
    return (folders ?? [])
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => (
        <div key={folder.id}>
          <button
            type="button"
            className={`explorer-tree__item ${currentId === folder.id ? 'is-active' : ''}`}
            style={{ '--tree-depth': depth }}
            onClick={() => setCurrentId(folder.id)}
            title={folder.name}
          >
            <span aria-hidden="true">📁</span><span>{folder.name}</span>
          </button>
          {renderFolderTree(folder.id, depth + 1)}
        </div>
      ));
  }

  if (folders === null) return <p className="explorer__status" role="status">Unlocking your vault…</p>;

  const atRoot = currentId === vaultId;

  return (
    <section className="explorer-layout" aria-label="Vault file explorer">
      <aside className="explorer-sidebar">
        <button type="button" className={`explorer-tree__item explorer-tree__root ${atRoot ? 'is-active' : ''}`} onClick={() => setCurrentId(vaultId)}>
          <span aria-hidden="true">⌂</span><span>My vault</span>
        </button>
        <div className="explorer-sidebar__label">FOLDERS</div>
        {renderFolderTree(vaultId)}
        <div className="explorer-sidebar__note">
          <span aria-hidden="true">🔐</span>
          <p>Your files and folder names are encrypted on this device before they are uploaded.</p>
        </div>
      </aside>

      <div className="explorer explorer-content">
        <div className="explorer-heading">
          <div>
            <p className="explorer-eyebrow">YOUR SECURE SPACE</p>
            <h1 className="explorer__title">{atRoot ? 'My vault' : (byId.get(currentId)?.name ?? 'Folder')}</h1>
            <nav className="explorer__crumbs" aria-label="Folder path">
              {trail.map((folder, index) => (
                <span key={folder.id}>
                  {index > 0 && <span aria-hidden="true" className="explorer__separator">/</span>}
                  {folder.id === currentId
                    ? <span aria-current="page">{folder.id === vaultId ? 'My vault' : folder.name}</span>
                    : <button type="button" className="explorer__crumb" onClick={() => setCurrentId(folder.id)}>{folder.id === vaultId ? 'My vault' : folder.name}</button>}
                </span>
              ))}
            </nav>
          </div>
          <div className="explorer-heading__actions">
            {!atRoot && (
              <label className="btn btn--primary explorer__upload-button">
                <input type="file" multiple hidden onChange={onPickFiles} disabled={progress !== null} aria-label="Upload files to this folder" />
                <span aria-hidden="true">↑</span> Upload files
              </label>
            )}
            <Button onClick={() => setShowCreate((value) => !value)}><span aria-hidden="true">＋</span> New folder</Button>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {progress && (
          <div className="explorer-upload-status" role="status">
            <span className="spinner" aria-hidden="true" />
            Encrypting and uploading <strong>{progress.name}</strong> · {progress.done}/{progress.total} chunks
          </div>
        )}
        {showCreate && (
          <form className="explorer-create" onSubmit={onCreate} noValidate>
            <div className="explorer-create__copy"><strong>Create a folder</strong><span>Its name will be encrypted before it leaves your device.</span></div>
            <TextField label="Folder name" value={name} maxLength={FOLDER_NAME_MAX} onChange={(event) => setName(event.target.value)} autoComplete="off" />
            <Button type="submit" loading={busy}>Create</Button>
            <Button type="button" variant="ghost" onClick={() => { setShowCreate(false); setName(''); }}>Cancel</Button>
          </form>
        )}

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

        <div className="explorer-section-heading">
          <h2>Folders</h2><span>{visibleFolders.length}</span>
        </div>
        {visibleFolders.length > 0 ? (
          <div className={`explorer-items explorer-items--${viewMode}`}>
            {visibleFolders.map((folder) => (
              <article className="explorer-folder-card" key={folder.id}>
                <button type="button" className="explorer-folder-card__open" onClick={() => { setCurrentId(folder.id); setQuery(''); }} aria-label={`Open ${folder.name}`}>
                  <span className="explorer-folder-card__icon" aria-hidden="true">📁</span>
                  <span className="explorer-folder-card__name">{folder.name}</span>
                  <span className="explorer-folder-card__meta">Encrypted folder</span>
                </button>
                <button type="button" className="explorer-folder-card__share" onClick={() => setSharing(folder)} aria-label={`Share ${folder.name}`}>Share</button>
              </article>
            ))}
          </div>
        ) : (
          <p className="explorer-inline-empty">{query ? 'No folders match your search.' : 'No folders in this location yet.'}</p>
        )}

        <div className="explorer-section-heading explorer-section-heading--files">
          <h2>Files</h2><span>{visibleFiles.length}</span>
        </div>
        {visibleFiles.length > 0 ? (
          <div className={`explorer-items explorer-items--files explorer-items--${viewMode}`}>
            {visibleFiles.map((file) => (
              <article className="explorer-file-card" key={file.id}>
                <div className="explorer-file-card__identity">
                  <span className="explorer-file-card__icon" aria-hidden="true">▤</span>
                  <span className="explorer-file-card__details"><strong>{file.name}</strong><small>{formatSize(file.size)} · Encrypted</small></span>
                </div>
                <div className="explorer-file-card__actions">
                  <button type="button" disabled={workingFileId === file.id} onClick={() => onDownload(file)}>↓ Download</button>
                  <button type="button" className="is-danger" disabled={workingFileId === file.id} onClick={() => onDelete(file)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="explorer-empty-state">
            <span aria-hidden="true">▤</span>
            <strong>{query ? 'No files found' : 'No files here yet'}</strong>
            <p>{atRoot ? 'Open a folder to upload files. This keeps your vault neatly organised.' : 'Upload a file to this folder. It will be encrypted on your device first.'}</p>
            {!atRoot && (
              <label className="btn btn--primary explorer__upload-button">
                <input type="file" multiple hidden onChange={onPickFiles} disabled={progress !== null} aria-label="Upload files to this folder" />
                <span aria-hidden="true">↑</span> Upload your first file
              </label>
            )}
          </div>
        )}

        {sharing && <SharePanel folder={sharing} onClose={() => setSharing(null)} />}
        <p className="explorer-footer"><span aria-hidden="true">🔒</span> End-to-end encrypted · Only you hold the keys</p>
      </div>
    </section>
  );
}
