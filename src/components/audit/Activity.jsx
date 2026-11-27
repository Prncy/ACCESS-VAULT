import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuditLog } from '../../services/auditService.js';
import { listFolders } from '../../services/folderFlow.js';
import { listFiles } from '../../services/fileFlow.js';

const PAGE_SIZE = 50;

const ACTION_LABELS = {
  REGISTER: 'Created an account',
  LOGIN: 'Signed in',
  CREATE_FOLDER: 'Created a folder',
  UPLOAD: 'Uploaded a file',
  DOWNLOAD: 'Downloaded a file',
  DELETE: 'Deleted an item',
  SHARE: 'Shared an item',
  REVOKE: 'Revoked access',
  CHANGE_ROLE: 'Changed a role',
};

function formatDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

function resourceKey(type, id) {
  return id ? `${String(type ?? '').toLowerCase()}:${id}` : null;
}

export default function Activity() {
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(true);

  const loadNames = useCallback(async () => {
    try {
      const folders = await listFolders();
      const lookup = {};
      folders.forEach((folder) => {
        lookup[resourceKey('folder', folder.id)] = folder.id === folders[0]?.id ? 'My vault' : folder.name;
      });
      const fileLists = await Promise.all(
        folders.map((folder) => listFiles(folder.id).catch(() => [])),
      );
      fileLists.flat().forEach((file) => {
        lookup[resourceKey('file', file.id)] = file.name;
      });
      setNames(lookup);
    } catch {
      // Activity remains useful when an item can no longer be decrypted or listed.
      setNames({});
    }
  }, []);

  const loadPage = useCallback(async (append) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const before = append && rows.length ? rows[rows.length - 1].occurred_at : null;
      const next = await getAuditLog({ limit: PAGE_SIZE, before });
      setRows((current) => append ? [...current, ...next] : next);
      setHasMore(next.length === PAGE_SIZE);
    } catch (err) {
      setError(err?.message || 'Could not load activity. Please try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [rows]);

  useEffect(() => {
    loadPage(false);
    loadNames();
  }, []); // load once when the Activity view opens

  const renderedRows = useMemo(() => rows.map((row) => {
    const name = names[resourceKey(row.resource_type, row.resource_id)];
    const item = row.resource_id ? (name ?? 'Deleted item') : null;
    return { ...row, item };
  }), [rows, names]);

  return (
    <section className="activity" aria-labelledby="activity-title">
      <div className="activity__heading">
        <div>
          <p className="explorer-eyebrow">SECURITY &amp; ACCOUNT</p>
          <h1 className="explorer__title" id="activity-title">Activity</h1>
          <p className="activity__intro">Recent actions on your account and items you own.</p>
        </div>
        <button type="button" className="activity__refresh" onClick={() => { loadPage(false); loadNames(); }} disabled={loading || loadingMore}>Refresh</button>
      </div>

      {error && <p className="activity__error" role="alert">{error}</p>}
      {loading ? <p className="activity__empty" role="status">Loading activity…</p> : renderedRows.length === 0 ? (
        <p className="activity__empty">No activity to show yet.</p>
      ) : (
        <ol className="activity__list">
          {renderedRows.map((row) => (
            <li className="activity__item" key={row.log_id}>
              <span className="activity__marker" aria-hidden="true">•</span>
              <div className="activity__body">
                <strong>{ACTION_LABELS[row.action] ?? row.action}</strong>
                {row.item && <span className="activity__resource">{row.item}</span>}
                <p>
                  {row.is_me ? 'You' : (row.actor_name || 'A user')}
                  {row.recipient_name ? ` · Recipient: ${row.recipient_name}` : ''}
                </p>
                <time dateTime={row.occurred_at}>{formatDate(row.occurred_at)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
      {!loading && hasMore && rows.length > 0 && (
        <button type="button" className="activity__load-more" onClick={() => loadPage(true)} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
