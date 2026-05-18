import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { logout } from '../auth/authSlice';
import { createProfile, deleteProfile, listProfiles } from '../../lib/profileApi';
import type { JobProfileListItem } from '../../shared/models/profile.model';

export function JobProfilesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const token = useAppSelector((s) => s.auth.token) ?? '';

  const [profiles, setProfiles] = useState<JobProfileListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await listProfiles(token);
      setProfiles(data);
    } catch (err) {
      const res = err as Response;
      if (res?.status === 401) { dispatch(logout()); navigate('/auth/login'); }
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [dispatch, navigate, token]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    const name = newName.trim() || 'My Profile';
    setSaving(true);
    try {
      const created = await createProfile(token, name);
      navigate(`/job-profiles/${created.id}`);
    } catch {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteProfile(token, id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <span className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="material-icons text-[48px] text-red-500">error_outline</span>
        <p className="mb-4 mt-4 text-sm text-gray-500 dark:text-gray-400">Failed to load job profiles.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <span className="material-icons text-base">refresh</span> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-md transition-colors dark:bg-gray-800">
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5 dark:border-gray-700">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Job Profiles</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Create separate profiles tailored to different roles or companies
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setCreating((c) => !c); setNewName(''); }}
          className={
            creating
              ? 'flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700'
              : 'flex cursor-pointer items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-400 dark:bg-transparent dark:text-blue-400 dark:hover:bg-blue-900/30'
          }
        >
          <span className="material-icons text-base">{creating ? 'close' : 'add'}</span>
          New Profile
        </button>
      </div>

      {creating && (
        <div className="mx-6 mb-2 mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-900/20">
          <label className="mb-2 block text-sm font-medium text-blue-800 dark:text-blue-300">
            Profile name
          </label>
          <input
            type="text"
            autoFocus
            className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
            placeholder="e.g. Senior Backend Engineer, ML Research Scientist…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
              className="flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <span className="material-icons text-base">add</span>
              )}
              Create
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => { setCreating(false); setNewName(''); }}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {profiles.length === 0 && !creating && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="material-icons text-[48px] text-gray-300 dark:text-gray-600">work_outline</span>
          <p className="text-sm text-gray-500 dark:text-gray-400">No job profiles yet. Create one to get started.</p>
        </div>
      )}

      {profiles.length > 0 && (
        <ul className="divide-y divide-gray-100 px-6 py-2 dark:divide-gray-700">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              onClick={() => navigate(`/job-profiles/${profile.id}`)}
              className="group -mx-6 flex cursor-pointer items-center gap-4 rounded-lg px-6 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
                <span className="material-icons text-base text-blue-600 dark:text-blue-400">work</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-800 dark:text-white">{profile.name}</p>
                {(profile.fullName || profile.title) && (
                  <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                    {[profile.fullName, profile.title].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); navigate(`/job-profiles/${profile.id}/cv`); }}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:text-gray-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
                  title="Generate CV"
                >
                  <span className="material-icons text-base">picture_as_pdf</span>
                </button>
                <button
                  type="button"
                  disabled={deletingId === profile.id}
                  onClick={(e) => void handleDelete(profile.id, e)}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40 dark:text-gray-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  title="Delete profile"
                >
                  {deletingId === profile.id
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                    : <span className="material-icons text-base">delete</span>}
                </button>
                <span className="material-icons text-base text-gray-300 transition-colors group-hover:text-blue-500 dark:text-gray-600 dark:group-hover:text-blue-400">
                  chevron_right
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
