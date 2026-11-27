import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '../Alert.jsx';
import Button from '../Button.jsx';
import TextField from '../TextField.jsx';
import SharePanel from './SharePanel.jsx';
import { FOLDER_NAME_MAX, createSubfolder, deleteSubfolder, getVaultFolderId, listFolders, renameSubfolder } from '../../services/folderFlow.js';
import { formatSize, saveBlob } from '../../utils/format.js';
import { MAX_FILE_BYTES, deleteFile, downloadFile, listFiles, uploadFile } from '../../services/fileFlow.js';
import { getBackend } from '../../services/authFlow.js';

const dateValue = (value) => value ? new Date(value).getTime() : 0;

/** Secure file explorer. Plain names and ids stay in the browser; encryption remains in the flow services. */
export default function FolderExplorer() {
  const [folders, setFolders] = useState(null);
  const [vaultId, setVaultId] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [name, setName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(null);
  const [workingFileId, setWorkingFileId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [viewMode, setViewMode] = useState('list');
  const [selectedFileIds, setSelectedFileIds] = useState([]);

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
    setSelectedFileIds([]);
    // The root vault is a navigation/container view only. Files can exist only inside subfolders.
    if (currentId === vaultId) return () => { cancelled = true; };
    listFiles(currentId)
      .then((list) => !cancelled && setFiles(list))
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [currentId, folders, vaultId]);

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

  async function onRenameSubmit(event) {
    event.preventDefault();
    if (!renameTarget || folderBusy) return;
    const clean = renameValue.trim();
    if (!clean || clean.length > FOLDER_NAME_MAX || /[\\\\/]/.test(clean)) {
      setError('Enter a valid folder name.');
      return;
    }
    const duplicate = (folders ?? []).some((folder) =>
      folder.id !== renameTarget.id &&
      folder.parentId === renameTarget.parentId &&
      folder.name.toLocaleLowerCase() === clean.toLocaleLowerCase()
    );
    if (duplicate) {
      setError('A folder with that name already exists here.');
      return;
    }
    setFolderBusy(true);
    setError(null);
    try {
      await renameSubfolder(renameTarget.id, clean);
      setFolders((current) => current.map((folder) =>
        folder.id === renameTarget.id ? { ...folder, name: clean } : folder
      ));
      setRenameTarget(null);
      setRenameValue('');
    } catch (err) {
      console.error('[FolderExplorer] rename failed', err);
      setError(err.message || 'Could not rename folder. Please try again.');
    } finally {
      setFolderBusy(false);
    }
  }

  async function onDeleteFolder(folder) {
    if (folderBusy) return;
    const descendants = new Set([folder.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of folders ?? []) {
        if (descendants.has(item.parentId) && !descendants.has(item.id)) {
          descendants.add(item.id);
          changed = true;
        }
      }
    }
    let fileCount = 0;
    try {
      const preview = await getBackend().getFolderFiles(folder.id);
      fileCount = preview.length;
    } catch (err) {
      console.error('[FolderExplorer] deletion preview failed', err);
      setError(err.message || 'Could not prepare folder deletion. Please try again.');
      return;
    }
    const childFolderCount = Math.max(0, descendants.size - 1);
    let sharedWarning = '';
    try {
      const sharesByFolder = await Promise.all([...descendants].map((id) => getBackend().listShares(id)));
      if (sharesByFolder.some((list) => list.length > 0)) {
        sharedWarning = ' People you shared this with will lose access.';
      }
    } catch (err) {
      console.error('[FolderExplorer] share preview failed', err);
      setError('Could not check sharing before deletion. Please try again.');
      return;
    }
    const confirmed = window.confirm(
      `Permanently delete "${folder.name}"? This includes ${childFolderCount} subfolder(s) and ${fileCount} file(s). This cannot be undone.${sharedWarning}`
    );
    if (!confirmed) return;

    setFolderBusy(true);
    setError(null);
    try {
      const result = await deleteSubfolder(folder.id);
      setFolders((current) => (current ?? []).filter((item) => !result.folderIds.includes(item.id)));
      if (result.folderIds.includes(currentId)) setCurrentId(result.parentId);
      setSharing(null);
      setSelectedFileIds([]);
    } catch (err) {
      console.error('[FolderExplorer] delete failed', err);
      setError('Couldn\'t delete, try again.');
    } finally {
      setFolderBusy(false);
    }
  }

  async function onPickFiles(event) {
    if (currentId === vaultId) {
      event.target.value = '';
      setError('Open or create a folder before uploading files.');
      return;
    }
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
    setDownloadProgress({
      name: file.name,
      stage: 'preparing',
      bytesDone: 0,
      totalBytes: file.size,
      chunksDone: 0,
      totalChunks: 0,
    });
    setError(null);
    try {
      const { name: fileName, blob } = await downloadFile(file.id, currentId, {
        onProgress: (next) => setDownloadProgress({ name: file.name, ...next, totalBytes: next.totalBytes || file.size }),
      });
      setDownloadProgress((current) => current ? { ...current, stage: 'saving' } : current);
      saveBlob(fileName, blob);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkingFileId(null);
      setDownloadProgress(null);
    }
  }

  async function onDelete(file) {
    if (!window.confirm(`Delete ${file.name}? This cannot be undone.`)) return;
    setWorkingFileId(file.id);
    setError(null);
    try {
      await deleteFile(file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
      setSelectedFileIds((current) => current.filter((id) => id !== file.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setWorkingFileId(null);
    }
  }

  async function onBulkDownload() {
    const selected = visibleFiles.filter((file) => selectedFileIds.includes(file.id));
    for (const file of selected) await onDownload(file);
  }

  async function onBulkDelete() {
    const selected = visibleFiles.filter((file) => selectedFileIds.includes(file.id));
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected file(s)? This cannot be undone.`)) return;
    setError(null);
    for (const file of selected) {
      setWorkingFileId(file.id);
      try {
        await deleteFile(file.id);
        setFiles((current) => current.filter((item) => item.id !== file.id));
      } catch (err) {
        setError(err.message);
      }
    }
    setWorkingFileId(null);
    setSelectedFileIds([]);
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
              <>
                <button type="button" className="explorer-icon-button" title="Rename folder" disabled={folderBusy} onClick={() => { setRenameTarget(byId.get(currentId)); setRenameValue(byId.get(currentId)?.name ?? ''); }}>✎</button>
                <button type="button" className="explorer-icon-button is-danger" title="Delete folder" disabled={folderBusy} onClick={() => onDeleteFolder(byId.get(currentId))}>⌫</button>
                <label className="explorer-icon-button explorer-upload-trigger" title="Upload files">
                  <input type="file" multiple hidden onChange={onPickFiles} disabled={progress !== null} aria-label="Upload files to this folder" />
                  <span aria-hidden="true">↑</span>
                </label>
                <button type="button" className="explorer-icon-button" title="Share this folder" aria-label={`Share ${byId.get(currentId)?.name ?? 'this folder'}`} onClick={() => setSharing(byId.get(currentId))}>↗</button>
              </>
            )}
            <button type="button" className="explorer-icon-button" title="New folder" aria-label="Create a new folder" onClick={() => setShowCreate((value) => !value)}>＋</button>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {folderBusy && <div className="explorer-upload-status" role="status"><span className="spinner" aria-hidden="true" /> Updating folder…</div>}
        {renameTarget && (
          <form className="explorer-create" onSubmit={onRenameSubmit} noValidate>
            <div className="explorer-create__copy"><strong>Rename folder</strong><span>The new name will be encrypted on this device.</span></div>
            <TextField label="Folder name" value={renameValue} maxLength={FOLDER_NAME_MAX} onChange={(event) => setRenameValue(event.target.value)} autoComplete="off" />
            <Button type="submit" loading={folderBusy}>Save</Button>
            <Button type="button" variant="ghost" disabled={folderBusy} onClick={() => { setRenameTarget(null); setRenameValue(''); }}>Cancel</Button>
          </form>
        )}
        {progress && (
          <div className="explorer-upload-status" role="status">
            <span className="spinner" aria-hidden="true" />
            Encrypting and uploading <strong>{progress.name}</strong> · {progress.done}/{progress.total} chunks
          </div>
        )}
        {downloadProgress && (() => {
          const percent = downloadProgress.stage === 'saving'
            ? 100
            : downloadProgress.totalBytes > 0
              ? Math.min(100, Math.round((downloadProgress.bytesDone / downloadProgress.totalBytes) * 100))
              : 0;
          const message = downloadProgress.stage === 'preparing'
            ? 'Preparing secure download…'
            : downloadProgress.stage === 'decrypting'
              ? 'Verifying and decrypting…'
              : downloadProgress.stage === 'saving'
                ? 'Download ready'
                : 'Downloading…';
          return (
            <div className="explorer-download-status" role="status" aria-live="polite">
              <div className="explorer-download-status__top">
                <span><span className="spinner" aria-hidden="true" /> <strong>{message}</strong></span>
                {downloadProgress.stage === 'downloading' && <strong>{percent}%</strong>}
              </div>
              <div className="explorer-download-status__name">{downloadProgress.name}</div>
              <div className="explorer-download-status__track" role="progressbar" aria-label={message} aria-valuemin="0" aria-valuemax="100" aria-valuenow={downloadProgress.stage === 'saving' ? 100 : percent}>
                <span style={{ width: `${downloadProgress.stage === 'saving' ? 100 : percent}%` }} />
              </div>
              <small>{downloadProgress.stage === 'preparing'
                ? 'Getting the encrypted file and your key ready'
                : downloadProgress.stage === 'decrypting'
                  ? `Downloaded ${downloadProgress.chunksDone} of ${downloadProgress.totalChunks} chunks · Checking file integrity`
                  : downloadProgress.stage === 'saving'
                    ? 'Your browser is receiving the decrypted file'
                    : `${formatSize(downloadProgress.bytesDone)} of ${formatSize(downloadProgress.totalBytes)} · ${downloadProgress.chunksDone} of ${downloadProgress.totalChunks} chunks`}</small>
            </div>
          );
        })()}
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
                <button type="button" className="explorer-icon-button" title={`Rename ${folder.name}`} disabled={folderBusy} onClick={() => { setRenameTarget(folder); setRenameValue(folder.name); }}>✎</button>
                <button type="button" className="explorer-icon-button is-danger" title={`Delete ${folder.name}`} disabled={folderBusy} onClick={() => onDeleteFolder(folder)}>⌫</button>
                <button type="button" className="explorer-icon-button explorer-folder-card__share" title={`Share ${folder.name}`} onClick={() => setSharing(folder)} aria-label={`Share ${folder.name}`}>↗</button>
              </article>
            ))}
          </div>
        ) : (
          <p className="explorer-inline-empty">{query ? 'No folders match your search.' : 'No folders in this location yet.'}</p>
        )}

        {!atRoot && <>
        <div className="explorer-section-heading explorer-section-heading--files">
          <h2>Files</h2><span>{visibleFiles.length}</span>
        </div>
        {visibleFiles.length > 0 ? (
          <div className={`explorer-items explorer-items--files explorer-items--${viewMode}`}>
            {visibleFiles.map((file) => (
              <article className="explorer-file-card" key={file.id}>
                <div className="explorer-file-card__identity">
                  <input className="explorer-file-select" type="checkbox" checked={selectedFileIds.includes(file.id)} onChange={(event) => setSelectedFileIds((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))} aria-label={`Select ${file.name}`} />
                  <span className="explorer-file-card__icon" aria-hidden="true">▤</span>
                  <span className="explorer-file-card__details"><strong>{file.name}</strong><small>{formatSize(file.size)} · Encrypted</small></span>
                </div>
                <div className="explorer-file-card__actions">
                  <details className="explorer-item-menu">
                    <summary className="explorer-icon-button" aria-label={`More actions for ${file.name}`} title="More options">⋮</summary>
                    <div className="explorer-item-menu__panel">
                      <button type="button" disabled={workingFileId === file.id} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDownload(file); }}>Download</button>
                      <button type="button" className="is-danger" disabled={workingFileId === file.id} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDelete(file); }}>Delete</button>
                    </div>
                  </details>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="explorer-inline-empty">{query ? 'No files match your search.' : 'This folder is empty.'}</p>
        )}
        {selectedFileIds.length > 0 && <div className="explorer-selection-bar"><span>{selectedFileIds.length} selected</span><button type="button" className="explorer-icon-button" title="Download selected" aria-label="Download selected files" onClick={onBulkDownload}>↓</button><button type="button" className="explorer-icon-button is-danger" title="Delete selected" aria-label="Delete selected files" onClick={onBulkDelete}>⌫</button><button type="button" className="explorer-icon-button" title="Clear selection" aria-label="Clear selection" onClick={() => setSelectedFileIds([])}>×</button></div>}
        </>}

        {sharing && <SharePanel folder={sharing} onClose={() => setSharing(null)} />}
        <p className="explorer-footer"><span aria-hidden="true">🔒</span> End-to-end encrypted · Only you hold the keys</p>
      </div>
    </section>
  );
}
