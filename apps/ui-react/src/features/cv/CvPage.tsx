import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAppSelector } from '../../app/hooks';
import { createCv, deleteCv, getCvPdf, getDefaultCvPdf, listCvs, type CvListItem } from '../../lib/cvApi';

type Mode = 'list' | 'pdf';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CvPage() {
  const token = useAppSelector((s) => s.auth.token) ?? '';
  const navigate = useNavigate();
  const { id: profileId } = useParams<{ id: string }>();

  const [cvs, setCvs] = useState<CvListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [optimizationNotes, setOptimizationNotes] = useState('');

  const [mode, setMode] = useState<Mode>('list');
  const [selectedCv, setSelectedCv] = useState<CvListItem | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const rawBlobUrl = useRef<string | null>(null);

  const loadCvs = useCallback(async () => {
    if (!token || !profileId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const data = await listCvs(token, profileId);
      setCvs(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token, profileId]);

  useEffect(() => { void loadCvs(); }, [loadCvs]);

  useEffect(() => {
    return () => {
      if (rawBlobUrl.current) URL.revokeObjectURL(rawBlobUrl.current);
    };
  }, []);

  const generate = async () => {
    if (!token || !profileId) return;
    setGenerating(true);
    try {
      const cv = await createCv(token, profileId, optimizationNotes.trim() || null);
      setCvs((prev) => [cv, ...prev]);
      setCreating(false);
      setOptimizationNotes('');
    } catch {
      /* ignore — user can retry */
    } finally {
      setGenerating(false);
    }
  };

  const openDefaultPdf = async () => {
    if (!profileId) return;
    setSelectedCv(null);
    setMode('pdf');
    setPdfUrl(null);
    setPdfLoading(true);
    if (rawBlobUrl.current) { URL.revokeObjectURL(rawBlobUrl.current); rawBlobUrl.current = null; }
    try {
      const blob = await getDefaultCvPdf(token, profileId);
      const url = URL.createObjectURL(blob);
      rawBlobUrl.current = url;
      setPdfUrl(url);
    } catch {
      setMode('list');
    } finally {
      setPdfLoading(false);
    }
  };

  const openPdf = async (cv: CvListItem) => {
    if (!profileId) return;
    setSelectedCv(cv);
    setMode('pdf');
    setPdfUrl(null);
    setPdfLoading(true);
    if (rawBlobUrl.current) { URL.revokeObjectURL(rawBlobUrl.current); rawBlobUrl.current = null; }
    try {
      const blob = await getCvPdf(token, profileId, cv.id);
      const url = URL.createObjectURL(blob);
      rawBlobUrl.current = url;
      setPdfUrl(url);
    } catch {
      setMode('list');
    } finally {
      setPdfLoading(false);
    }
  };

  const closePdf = () => {
    setMode('list');
    setSelectedCv(null);
    setPdfUrl(null);
    if (rawBlobUrl.current) { URL.revokeObjectURL(rawBlobUrl.current); rawBlobUrl.current = null; }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteCv(token, profileId!, id);
      setCvs((prev) => prev.filter((c) => c.id !== id));
    } catch {
      /* ignore */
    }
  };

  const downloadPdf = () => {
    if (!rawBlobUrl.current) return;
    const a = document.createElement('a');
    a.href = rawBlobUrl.current;
    a.download = selectedCv ? `${selectedCv.title.replace(/\s+/g, '_')}_CV.pdf` : 'Default_CV.pdf';
    a.click();
  };

  if (mode === 'pdf') {
    return (
      <div className="overflow-hidden rounded-2xl bg-white shadow-md transition-colors dark:bg-gray-800">
        <div className="flex items-center gap-4 border-b border-gray-100 px-6 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={closePdf}
            className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent text-sm font-medium text-gray-500 transition-colors hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <span className="material-icons text-base">arrow_back</span> Back
          </button>
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-800 dark:text-white">{selectedCv?.title ?? 'Default CV'}</p>
            {selectedCv?.optimizationNotes
              ? <p className="truncate text-xs italic text-gray-400 dark:text-gray-500">{selectedCv.optimizationNotes}</p>
              : !selectedCv && <p className="text-xs text-gray-400 dark:text-gray-500">Profile as-is, no AI changes</p>
            }
          </div>
          <button
            type="button"
            disabled={!pdfUrl}
            onClick={downloadPdf}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 dark:border-gray-600 dark:bg-transparent dark:text-gray-300 dark:hover:text-blue-400"
          >
            <span className="material-icons text-base">download</span>
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
        {pdfLoading && (
          <div className="flex h-80 flex-col items-center justify-center gap-4">
            <span className="h-12 w-12 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600 dark:border-blue-900" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading PDF…</p>
          </div>
        )}
        {pdfUrl && <iframe src={pdfUrl} className="block h-[75vh] w-full" title="CV Preview" />}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-md transition-colors dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5 dark:border-gray-700">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">My CVs</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">AI-generated CVs based on your profile</p>
        </div>
        <button
          type="button"
          onClick={() => { setCreating((c) => !c); setOptimizationNotes(''); }}
          className={
            creating
              ? 'flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700'
              : 'flex cursor-pointer items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-400 dark:bg-transparent dark:text-blue-400 dark:hover:bg-blue-900/30'
          }
        >
          <span className="material-icons text-base">{creating ? 'close' : 'add'}</span>
          New CV
        </button>
      </div>

      {/* Create panel */}
      {creating && (
        <div className="mx-6 mb-2 mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-900/20">
          <label className="mb-2 block text-sm font-medium text-blue-800 dark:text-blue-300">
            Optimization notes <span className="font-normal text-blue-600 dark:text-blue-400">(optional)</span>
          </label>
          <textarea
            rows={3}
            className="w-full resize-none rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
            placeholder="e.g. Targeting a senior backend role at a fintech startup. Emphasize Go and distributed systems experience."
            value={optimizationNotes}
            onChange={(e) => setOptimizationNotes(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={generating}
              onClick={() => void generate()}
              className="flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <span className="material-icons text-base">auto_awesome</span>
              )}
              {generating ? 'Generating…' : 'Generate CV'}
            </button>
            <button
              type="button"
              disabled={generating}
              onClick={() => { setCreating(false); setOptimizationNotes(''); }}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        </div>
      )}

      {/* Error */}
      {loadError && (
        <div className="flex flex-col items-center gap-3 py-16">
          <span className="material-icons text-[40px] text-red-400">error_outline</span>
          <p className="text-sm text-gray-500 dark:text-gray-400">Failed to load CVs.</p>
          <button
            type="button"
            onClick={() => void loadCvs()}
            className="flex cursor-pointer items-center gap-1 border-0 bg-transparent text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            <span className="material-icons text-base">refresh</span> Retry
          </button>
        </div>
      )}

      {/* Default CV + AI-generated list */}
      {!loading && (
        <ul className="divide-y divide-gray-100 px-6 py-2 dark:divide-gray-700">
          {/* Default CV (always shown when not in error state) */}
          {!loadError && (
            <li
              onClick={() => void openDefaultPdf()}
              className="group -mx-6 flex cursor-pointer items-center gap-4 rounded-lg px-6 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                <span className="material-icons text-base">person</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-white">Default CV</p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">Profile as-is, no AI changes</p>
              </div>
              <span className="material-icons shrink-0 text-base text-gray-300 transition-colors group-hover:text-blue-500 dark:text-gray-600 dark:group-hover:text-blue-400">
                open_in_new
              </span>
            </li>
          )}

          {cvs.map((cv, i) => (
            <li
              key={cv.id}
              onClick={() => void openPdf(cv)}
              className="group -mx-6 flex cursor-pointer items-center gap-4 rounded-lg px-6 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
                {cvs.length - i}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800 dark:text-white">{cv.title}</p>
                <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                  {formatDate(cv.createdAt)}
                  {cv.optimizationNotes && <span className="italic"> · {cv.optimizationNotes}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="material-icons text-base text-gray-300 transition-colors group-hover:text-blue-500 dark:text-gray-600 dark:group-hover:text-blue-400">
                  open_in_new
                </span>
                <button
                  type="button"
                  onClick={(e) => void handleDelete(cv.id, e)}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                >
                  <span className="material-icons text-base">delete</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Footer link */}
      <div className="border-t border-gray-100 px-6 py-4 dark:border-gray-700">
        <button
          type="button"
          onClick={() => navigate(`/job-profiles/${profileId}`)}
          className="flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent text-sm text-gray-500 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
        >
          <span className="material-icons text-base">arrow_back</span> Back to Profile
        </button>
      </div>
    </div>
  );
}
