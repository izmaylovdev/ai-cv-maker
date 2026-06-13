'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface UsageLimit {
  maxCostUsd: number;
}

export default function SettingsPage() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get('/api/usage-limit')
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${r.status}`);
        return r.json();
      })
      .then((data: UsageLimit) => {
        setValue(String(data.maxCostUsd));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const maxCostUsd = Number(value);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      setError('Enter a positive dollar amount.');
      setSaving(false);
      return;
    }

    try {
      const res = await api.put('/api/usage-limit', { maxCostUsd });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const data: UsageLimit = await res.json();
      setValue(String(data.maxCostUsd));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-medium text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Global per-user LLM spending limit. Once a user&apos;s estimated AI cost reaches
          this amount, their AI requests are blocked.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && (
        <form
          onSubmit={handleSave}
          className="bg-white rounded-lg border border-gray-200 p-6 max-w-md"
        >
          <label htmlFor="limit" className="block text-sm font-medium text-gray-700 mb-1.5">
            Spending limit per user (USD)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">$</span>
            <input
              id="limit"
              type="number"
              step="0.01"
              min="0.01"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {saved && (
            <p className="mt-3 text-sm text-green-600">Limit updated.</p>
          )}
          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </form>
      )}
    </div>
  );
}
