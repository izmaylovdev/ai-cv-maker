import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { logout } from '../auth/authSlice';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { extractProfileFromCv, getProfile, optimizeProfile, updateProfile, type ProfileUpdatePayload } from '../../lib/profileApi';
import { PhoneInput } from '../../shared/components/PhoneInput';
import { ProfilePreview } from '../../shared/components/ProfilePreview';
import type { Profile } from '../../shared/models/profile.model';
import { SortableSkillChip, type SkillRow } from './SortableSkillChip';
import { EnhancedTextarea } from '../../shared/components/EnhancedTextarea';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'work', label: 'Work Experience' },
  { id: 'education', label: 'Education' },
  { id: 'skills', label: 'Skills' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const TAB_IDS: TabId[] = TABS.map((t) => t.id);

type WorkRow = {
  clientId: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
};

type EduRow = {
  clientId: string;
  institution: string;
  degree: string;
  field: string;
  startYear: string;
  endYear: string;
};

type FormState = {
  name: string;
  fullName: string;
  title: string;
  overview: string;
  location: string;
  contacts: { email: string; phone: string };
  workExperiences: WorkRow[];
  educations: EduRow[];
  skills: SkillRow[];
};

const emptyForm = (): FormState => ({
  name: '',
  fullName: '',
  title: '',
  overview: '',
  location: '',
  contacts: { email: '', phone: '' },
  workExperiences: [],
  educations: [],
  skills: [],
});

function validateForm(form: FormState): boolean {
  if (!form.fullName.trim() || !form.title.trim() || !form.overview.trim()) return false;
  const email = form.contacts.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  for (const w of form.workExperiences) {
    if (!w.company.trim() || !w.role.trim() || !w.startDate.trim()) return false;
  }
  for (const e of form.educations) {
    if (!e.institution.trim() || !e.degree.trim() || !e.field.trim() || !e.startYear) {
      return false;
    }
    const sy = Number(e.startYear);
    if (Number.isNaN(sy) || sy < 1950 || sy > 2100) return false;
  }
  for (const s of form.skills) {
    if (!s.name.trim()) return false;
  }
  return true;
}

function toPayload(form: FormState): ProfileUpdatePayload {
  return {
    name: form.name,
    fullName: form.fullName,
    title: form.title,
    overview: form.overview,
    location: form.location.trim() === '' ? null : form.location.trim(),
    contacts: {
      email: form.contacts.email.trim() || undefined,
      phone: form.contacts.phone.trim() || undefined,
    },
    workExperiences: form.workExperiences.map((w) => ({
      company: w.company,
      role: w.role,
      startDate: w.startDate,
      endDate: w.endDate.trim() === '' ? null : w.endDate,
      description: w.description,
    })),
    educations: form.educations.map((e) => ({
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      startYear: Number(e.startYear),
      endYear:
        e.endYear.trim() === '' || e.endYear === undefined
          ? null
          : Number(e.endYear),
    })),
    skills: form.skills.map((s) => ({ name: s.name })),
  } as ProfileUpdatePayload;
}

export function ProfilePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const route = useLocation();
  const { id: profileId } = useParams<{ id: string }>();
  const token = useAppSelector((s) => s.auth.token) ?? '';

  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'form' | 'list'>('form');
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [touched, setTouched] = useState(false);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizeMessage, setOptimizeMessage] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hash = route.hash.replace('#', '');
  const activeTab: TabId = TAB_IDS.includes(hash as TabId)
    ? (hash as TabId)
    : 'overview';

  const setTab = useCallback(
    (id: TabId) => {
      navigate({ hash: id }, { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    if (!route.hash || !TAB_IDS.includes(hash as TabId)) {
      navigate({ hash: 'overview' }, { replace: true });
    }
  }, [hash, route.hash, navigate]);

  const loadProfile = useCallback(async () => {
    if (!token || !profileId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const profile = await getProfile(token, profileId);
      const sortedWork = [...(profile.workExperiences ?? [])].sort((a, b) => {
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        if (bEnd !== aEnd) return bEnd - aEnd;
        return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      });
      const sortedEdu = [...(profile.educations ?? [])].sort((a, b) => {
        const aEnd = a.endYear ?? Infinity;
        const bEnd = b.endYear ?? Infinity;
        if (bEnd !== aEnd) return bEnd - aEnd;
        return b.startYear - a.startYear;
      });

      setForm({
        name: profile.name,
        fullName: profile.fullName,
        title: profile.title,
        overview: profile.overview,
        location: profile.location ?? '',
        contacts: {
          email: profile.contacts?.email ?? '',
          phone: profile.contacts?.phone ?? '',
        },
        workExperiences: sortedWork.map((w) => ({
          clientId: crypto.randomUUID(),
          company: w.company,
          role: w.role,
          startDate: w.startDate,
          endDate: w.endDate ?? '',
          description: w.description ?? '',
        })),
        educations: sortedEdu.map((e) => ({
          clientId: crypto.randomUUID(),
          institution: e.institution,
          degree: e.degree,
          field: e.field,
          startYear: String(e.startYear),
          endYear: e.endYear != null ? String(e.endYear) : '',
        })),
        skills:
          profile.skills?.map((s) => ({
            clientId: crypto.randomUUID(),
            name: s.name,
          })) ?? [],
      });
    } catch (err) {
      const res = err as Response;
      if (res?.status === 401) {
        dispatch(logout());
        navigate('/auth/login');
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [dispatch, navigate, token, profileId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    window.setTimeout(() => setNotification(null), 4000);
  };

  const previewProfile: Profile | null = useMemo(
    () => ({
      id: '',
      name: form.name,
      fullName: form.fullName,
      title: form.title,
      overview: form.overview,
      location: form.location || undefined,
      contacts: {
        email: form.contacts.email || undefined,
        phone: form.contacts.phone || undefined,
      },
      workExperiences: form.workExperiences.map((w) => ({
        company: w.company,
        role: w.role,
        startDate: w.startDate,
        endDate: w.endDate || undefined,
        description: w.description,
      })),
      educations: form.educations.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field,
        startYear: Number(e.startYear) || 0,
        endYear: e.endYear.trim() === '' ? undefined : Number(e.endYear),
      })),
      skills: form.skills.map((s) => ({ name: s.name })),
    }),
    [form],
  );

  const save = async () => {
    setTouched(true);
    if (!validateForm(form)) {
      showNotification('Please fix validation errors before saving.', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateProfile(token, profileId!, toPayload(form));
      showNotification('Profile saved successfully!', 'success');
    } catch {
      showNotification('Failed to save profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const applyOptimization = async () => {
    if (!optimizeMessage.trim()) return;
    setOptimizing(true);
    try {
      const result = await optimizeProfile(token, profileId!, optimizeMessage.trim());
      setForm((f) => ({
        ...f,
        title: result.title,
        overview: result.overview,
        workExperiences: result.workExperiences.map((w) => ({
          clientId: crypto.randomUUID(),
          company: w.company,
          role: w.role,
          startDate: w.startDate,
          endDate: w.endDate ?? '',
          description: w.description,
        })),
        skills: result.skills.map((s) => ({
          clientId: crypto.randomUUID(),
          name: s.name,
        })),
      }));
      setOptimizeOpen(false);
      setOptimizeMessage('');
      showNotification('Profile optimized! Review the changes and save when ready.', 'success');
    } catch {
      showNotification('Failed to optimize profile. Please try again.', 'error');
    } finally {
      setOptimizing(false);
    }
  };

  const importFromCv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const extracted = await extractProfileFromCv(token, profileId!, file);
      setForm({
        name: form.name,
        fullName: extracted.fullName ?? '',
        title: extracted.title ?? '',
        overview: extracted.overview ?? '',
        location: extracted.location ?? '',
        contacts: {
          email: extracted.contacts?.email ?? '',
          phone: extracted.contacts?.phone ?? '',
        },
        workExperiences: (extracted.workExperiences ?? []).map((w) => ({
          clientId: crypto.randomUUID(),
          company: w.company,
          role: w.role,
          startDate: w.startDate,
          endDate: w.endDate ?? '',
          description: w.description ?? '',
        })),
        educations: (extracted.educations ?? []).map((e) => ({
          clientId: crypto.randomUUID(),
          institution: e.institution,
          degree: e.degree,
          field: e.field,
          startYear: String(e.startYear),
          endYear: e.endYear != null ? String(e.endYear) : '',
        })),
        skills: (extracted.skills ?? []).map((s) => ({
          clientId: crypto.randomUUID(),
          name: s.name,
        })),
      });
      showNotification('Profile extracted from CV! Review the details and save when ready.', 'success');
    } catch {
      showNotification('Failed to extract profile from CV. Please try again.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const addWork = () =>
    setForm((f) => ({
      ...f,
      workExperiences: [
        ...f.workExperiences,
        {
          clientId: crypto.randomUUID(),
          company: '',
          role: '',
          startDate: '',
          endDate: '',
          description: '',
        },
      ],
    }));

  const removeWork = (i: number) =>
    setForm((f) => ({
      ...f,
      workExperiences: f.workExperiences.filter((_, idx) => idx !== i),
    }));

  const addEdu = () =>
    setForm((f) => ({
      ...f,
      educations: [
        ...f.educations,
        {
          clientId: crypto.randomUUID(),
          institution: '',
          degree: '',
          field: '',
          startYear: '',
          endYear: '',
        },
      ],
    }));

  const removeEdu = (i: number) =>
    setForm((f) => ({
      ...f,
      educations: f.educations.filter((_, idx) => idx !== i),
    }));

  const addSkill = () =>
    setForm((f) => ({
      ...f,
      skills: [...f.skills, { clientId: crypto.randomUUID(), name: '' }],
    }));

  const removeSkill = (i: number) =>
    setForm((f) => ({
      ...f,
      skills: f.skills.filter((_, idx) => idx !== i),
    }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const onSkillDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setForm((prev) => {
      const oldIndex = prev.skills.findIndex((s) => s.clientId === active.id);
      const newIndex = prev.skills.findIndex((s) => s.clientId === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return { ...prev, skills: arrayMove(prev.skills, oldIndex, newIndex) };
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="material-icons text-[48px] text-red-500">error_outline</span>
        <p className="mb-4 mt-4 text-sm text-gray-500 dark:text-gray-400">
          Failed to load profile. Please check your connection and try again.
        </p>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          onClick={() => {
            setForm(emptyForm());
            void loadProfile();
          }}
        >
          <span className="material-icons text-base">refresh</span> Retry
        </button>
      </div>
    );
  }

  const fieldClass =
    'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500';

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-md transition-colors dark:bg-gray-800">
      <div className="px-6 pb-4 pt-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate('/job-profiles')}
            className="flex cursor-pointer items-center gap-1 border-0 bg-transparent text-sm text-gray-400 transition-colors hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400"
          >
            <span className="material-icons text-base">arrow_back</span>
            <span className="hidden sm:inline">Job Profiles</span>
          </button>
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => navigate(`/job-profiles/${profileId}/cv`)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-blue-400"
            >
              <span className="material-icons text-base">picture_as_pdf</span>
              Generate CV
            </button>
            <div className="flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={
                  viewMode === 'list'
                    ? 'flex cursor-pointer items-center gap-1.5 border-0 bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors'
                    : 'flex cursor-pointer items-center gap-1.5 border-0 bg-white px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }
              >
                <span className="material-icons text-base">list</span>
                Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode('form')}
                className={
                  viewMode === 'form'
                    ? 'flex cursor-pointer items-center gap-1.5 border-0 bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors'
                    : 'flex cursor-pointer items-center gap-1.5 border-0 bg-white px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }
              >
                <span className="material-icons text-base">edit</span>
                Edit
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActionsOpen((o) => !o)}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600 sm:hidden dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-blue-400"
          >
            <span className="material-icons text-base">{actionsOpen ? 'close' : 'more_vert'}</span>
          </button>
        </div>
        <h2 className="truncate text-xl font-bold text-gray-800 dark:text-white">
          {form.name || 'Job Profile'}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Fill in your details to generate an AI-powered CV
        </p>
        {actionsOpen && (
          <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 sm:hidden dark:border-gray-600 dark:bg-gray-700/50">
            <button
              type="button"
              onClick={() => { setViewMode('list'); setActionsOpen(false); }}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors ${viewMode === 'list' ? 'font-medium text-blue-600 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            >
              <span className="material-icons text-base">list</span>
              Preview
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('form'); setActionsOpen(false); }}
              className={`flex w-full items-center gap-3 border-t border-gray-200 px-4 py-3 text-sm transition-colors dark:border-gray-600 ${viewMode === 'form' ? 'font-medium text-blue-600 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            >
              <span className="material-icons text-base">edit</span>
              Edit
            </button>
            <button
              type="button"
              onClick={() => { navigate(`/job-profiles/${profileId}/cv`); setActionsOpen(false); }}
              className="flex w-full items-center gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <span className="material-icons text-base">picture_as_pdf</span>
              Generate CV
            </button>
            <button
              type="button"
              onClick={() => { setOptimizeOpen((o) => !o); setOptimizeMessage(''); setActionsOpen(false); }}
              className="flex w-full items-center gap-3 border-t border-gray-200 px-4 py-3 text-sm text-purple-600 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-purple-400 dark:hover:bg-gray-700"
            >
              <span className="material-icons text-base">auto_fix_high</span>
              Optimize with AI
            </button>
          </div>
        )}
      </div>

      {notification && (
        <div
          className={
            notification.type === 'success'
              ? 'mx-6 mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'mx-6 mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400'
          }
        >
          <span className="material-icons text-base">
            {notification.type === 'success' ? 'check_circle' : 'error_outline'}
          </span>
          {notification.message}
        </div>
      )}

      {viewMode === 'list' && <ProfilePreview profile={previewProfile} />}

      {viewMode === 'form' && (
        <div>
          <div className="border-b border-gray-200 px-6 dark:border-gray-700">
            <div className="-mb-px flex gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTab(tab.id)}
                  className={
                    activeTab === tab.id
                      ? 'cursor-pointer border-b-2 border-blue-600 bg-transparent px-4 py-2.5 text-sm font-medium text-blue-600 dark:border-blue-400 dark:text-blue-400'
                      : 'cursor-pointer border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'overview' && (
            <div className="flex flex-col gap-4 px-6 py-6">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Profile Name
                </label>
                <input
                  type="text"
                  className={fieldClass}
                  placeholder="e.g. Senior Backend Engineer, ML Researcher…"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                Personal Information
              </h3>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Full Name
                </label>
                <input
                  type="text"
                  className={fieldClass}
                  placeholder="John Doe"
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                />
                {touched && !form.fullName.trim() && (
                  <span className="text-xs text-red-500">Full name is required</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Professional Title
                </label>
                <input
                  type="text"
                  className={fieldClass}
                  placeholder="Senior Software Engineer"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
                {touched && !form.title.trim() && (
                  <span className="text-xs text-red-500">Title is required</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Location
                </label>
                <input
                  type="text"
                  className={fieldClass}
                  placeholder="Berlin, Germany"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Professional Overview
                </label>
                <EnhancedTextarea
                  rows={5}
                  className={`${fieldClass} resize-none`}
                  placeholder="Brief description of your professional background, key achievements, and career goals..."
                  value={form.overview}
                  onChange={(v) => setForm((f) => ({ ...f, overview: v }))}
                  profileId={profileId ?? ''}
                  token={token}
                  onError={(msg) => showNotification(msg, 'error')}
                  fieldPurpose="Professional Overview / Summary for a CV. This is the main introduction paragraph that appears at the top of the CV. It should be 2-4 concise, compelling sentences capturing the candidate's professional identity, core strengths, and career goals. Maintain first or third person depending on the existing style."
                />
                {touched && !form.overview.trim() && (
                  <span className="text-xs text-red-500">Overview is required</span>
                )}
              </div>
              <h3 className="mt-2 text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                Contact Information
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Email
                  </label>
                  <input
                    type="email"
                    className={fieldClass}
                    placeholder="john@example.com"
                    value={form.contacts.email}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        contacts: { ...f.contacts, email: e.target.value },
                      }))
                    }
                  />
                  {touched &&
                    form.contacts.email &&
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contacts.email) && (
                      <span className="text-xs text-red-500">
                        Enter a valid email address
                      </span>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Phone
                  </label>
                  <PhoneInput
                    className={fieldClass}
                    placeholder="+38 (063) 78-312-49"
                    value={form.contacts.phone}
                    onValueChange={(phone) =>
                      setForm((f) => ({ ...f, contacts: { ...f.contacts, phone } }))
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'work' && (
            <div className="px-6 py-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                  Work Experience
                </h3>
                <button
                  type="button"
                  onClick={addWork}
                  className="flex cursor-pointer items-center gap-1 rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-400 dark:bg-transparent dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  <span className="material-icons text-base">add</span> Add Experience
                </button>
              </div>
              {form.workExperiences.length === 0 && (
                <p className="py-8 text-center text-sm italic text-gray-400 dark:text-gray-500">
                  No work experience added yet. Click &quot;Add Experience&quot; to start.
                </p>
              )}
              <div className="flex flex-col gap-4">
                {form.workExperiences.map((exp, i) => (
                  <div
                    key={exp.clientId}
                    className="rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors dark:border-gray-600 dark:bg-gray-700/50"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                        Experience {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeWork(i)}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                      >
                        <span className="material-icons text-base">delete</span>
                      </button>
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Company
                        </label>
                        <input
                          type="text"
                          className={fieldClass}
                          value={exp.company}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.workExperiences];
                              next[i] = { ...next[i], company: e.target.value };
                              return { ...f, workExperiences: next };
                            })
                          }
                        />
                        {touched && !exp.company.trim() && (
                          <span className="text-xs text-red-500">Company is required</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Role
                        </label>
                        <input
                          type="text"
                          className={fieldClass}
                          value={exp.role}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.workExperiences];
                              next[i] = { ...next[i], role: e.target.value };
                              return { ...f, workExperiences: next };
                            })
                          }
                        />
                        {touched && !exp.role.trim() && (
                          <span className="text-xs text-red-500">Role is required</span>
                        )}
                      </div>
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Start Date
                        </label>
                        <input
                          type="text"
                          className={fieldClass}
                          placeholder="2020-01-15"
                          value={exp.startDate}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.workExperiences];
                              next[i] = { ...next[i], startDate: e.target.value };
                              return { ...f, workExperiences: next };
                            })
                          }
                        />
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Format: YYYY-MM-DD
                        </span>
                        {touched && !exp.startDate.trim() && (
                          <span className="text-xs text-red-500">Start date is required</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          End Date
                        </label>
                        <input
                          type="text"
                          className={fieldClass}
                          placeholder="2023-06-30 or leave blank"
                          value={exp.endDate}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.workExperiences];
                              next[i] = { ...next[i], endDate: e.target.value };
                              return { ...f, workExperiences: next };
                            })
                          }
                        />
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Leave blank if current
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        Description
                      </label>
                      <EnhancedTextarea
                        rows={3}
                        className={`${fieldClass} resize-none`}
                        placeholder="Key responsibilities and achievements..."
                        value={exp.description}
                        onChange={(v) =>
                          setForm((f) => {
                            const next = [...f.workExperiences];
                            next[i] = { ...next[i], description: v };
                            return { ...f, workExperiences: next };
                          })
                        }
                        profileId={profileId ?? ''}
                        token={token}
                        onError={(msg) => showNotification(msg, 'error')}
                        fieldPurpose={`Work Experience description for a CV — role: "${exp.role || 'this position'}" at "${exp.company || 'this company'}". Should describe 2-4 key responsibilities and achievements using strong action verbs. Quantify impact with metrics where possible. Write in past tense for previous roles, present tense for current.`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'education' && (
            <div className="px-6 py-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                  Education
                </h3>
                <button
                  type="button"
                  onClick={addEdu}
                  className="flex cursor-pointer items-center gap-1 rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-400 dark:bg-transparent dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  <span className="material-icons text-base">add</span> Add Education
                </button>
              </div>
              {form.educations.length === 0 && (
                <p className="py-8 text-center text-sm italic text-gray-400 dark:text-gray-500">
                  No education added yet. Click &quot;Add Education&quot; to start.
                </p>
              )}
              <div className="flex flex-col gap-4">
                {form.educations.map((edu, i) => (
                  <div
                    key={edu.clientId}
                    className="rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors dark:border-gray-600 dark:bg-gray-700/50"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                        Education {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeEdu(i)}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                      >
                        <span className="material-icons text-base">delete</span>
                      </button>
                    </div>
                    <div className="mb-3 flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        Institution
                      </label>
                      <input
                        type="text"
                        className={fieldClass}
                        value={edu.institution}
                        onChange={(e) =>
                          setForm((f) => {
                            const next = [...f.educations];
                            next[i] = { ...next[i], institution: e.target.value };
                            return { ...f, educations: next };
                          })
                        }
                      />
                      {touched && !edu.institution.trim() && (
                        <span className="text-xs text-red-500">Institution is required</span>
                      )}
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Degree
                        </label>
                        <input
                          type="text"
                          className={fieldClass}
                          value={edu.degree}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.educations];
                              next[i] = { ...next[i], degree: e.target.value };
                              return { ...f, educations: next };
                            })
                          }
                        />
                        {touched && !edu.degree.trim() && (
                          <span className="text-xs text-red-500">Degree is required</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Field of Study
                        </label>
                        <input
                          type="text"
                          className={fieldClass}
                          value={edu.field}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.educations];
                              next[i] = { ...next[i], field: e.target.value };
                              return { ...f, educations: next };
                            })
                          }
                        />
                        {touched && !edu.field.trim() && (
                          <span className="text-xs text-red-500">Field is required</span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Start Year
                        </label>
                        <input
                          type="number"
                          className={fieldClass}
                          value={edu.startYear}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.educations];
                              next[i] = { ...next[i], startYear: e.target.value };
                              return { ...f, educations: next };
                            })
                          }
                        />
                        {touched && !edu.startYear && (
                          <span className="text-xs text-red-500">Start year is required</span>
                        )}
                        {touched &&
                          edu.startYear &&
                          (Number(edu.startYear) < 1950 || Number(edu.startYear) > 2100) && (
                            <span className="text-xs text-red-500">Invalid year</span>
                          )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          End Year
                        </label>
                        <input
                          type="number"
                          className={fieldClass}
                          placeholder="2020 or leave blank"
                          value={edu.endYear}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.educations];
                              next[i] = { ...next[i], endYear: e.target.value };
                              return { ...f, educations: next };
                            })
                          }
                        />
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Leave blank if current
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="px-6 py-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                  Skills
                </h3>
                <button
                  type="button"
                  onClick={addSkill}
                  className="flex cursor-pointer items-center gap-1 rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-400 dark:bg-transparent dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  <span className="material-icons text-base">add</span> Add Skill
                </button>
              </div>
              {form.skills.length === 0 && (
                <p className="py-8 text-center text-sm italic text-gray-400 dark:text-gray-500">
                  No skills added yet. Click &quot;Add Skill&quot; to start.
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onSkillDragEnd}
              >
                <SortableContext
                  items={form.skills.map((s) => s.clientId)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid min-h-12 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2 [grid-template-columns:repeat(auto-fill,minmax(8rem,1fr))] dark:border-gray-600 dark:bg-gray-700/30">
                    {form.skills.map((skill, i) => (
                      <SortableSkillChip
                        key={skill.clientId}
                        skill={skill}
                        onNameChange={(name) =>
                          setForm((f) => {
                            const next = [...f.skills];
                            next[i] = { ...next[i], name };
                            return { ...f, skills: next };
                          })
                        }
                        onRemove={() => removeSkill(i)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Drag chips to reorder</p>
            </div>
          )}

          {optimizeOpen && (
            <div className="mx-6 mb-4 rounded-xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-700 dark:bg-purple-900/20">
              <p className="mb-2 text-sm font-medium text-purple-800 dark:text-purple-300">
                Describe the role or goal you're optimizing for
              </p>
              <textarea
                rows={2}
                className="w-full rounded-lg border border-purple-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-purple-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
                placeholder="e.g. Senior React developer at a fintech startup, Staff engineer focused on distributed systems..."
                value={optimizeMessage}
                onChange={(e) => setOptimizeMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void applyOptimization();
                }}
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={optimizing || !optimizeMessage.trim()}
                  onClick={() => void applyOptimization()}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                  {optimizing ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <span className="material-icons text-base">auto_fix_high</span>
                  )}
                  {optimizing ? 'Optimizing…' : 'Apply'}
                </button>
                <button
                  type="button"
                  disabled={optimizing}
                  onClick={() => { setOptimizeOpen(false); setOptimizeMessage(''); }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3 border-t border-gray-100 px-6 pb-6 pt-4 dark:border-gray-700">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <span className="material-icons text-base">save</span>
              )}
              Save Profile
            </button>
            <button
              type="button"
              onClick={() => { setOptimizeOpen((o) => !o); setOptimizeMessage(''); }}
              className={
                optimizeOpen
                  ? 'hidden cursor-pointer items-center gap-2 rounded-lg border-0 bg-purple-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 sm:flex'
                  : 'hidden cursor-pointer items-center gap-2 rounded-lg border border-purple-600 bg-white px-5 py-2.5 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-50 sm:flex dark:border-purple-400 dark:bg-transparent dark:text-purple-400 dark:hover:bg-purple-900/30'
              }
            >
              <span className="material-icons text-base">auto_fix_high</span> Optimize with AI
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt"
              className="hidden"
              onChange={(e) => void importFromCv(e)}
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-green-600 bg-white px-5 py-2.5 text-sm font-medium text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50 dark:border-green-400 dark:bg-transparent dark:text-green-400 dark:hover:bg-green-900/30"
            >
              {importing ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent dark:border-green-400" />
              ) : (
                <span className="material-icons text-base">upload_file</span>
              )}
              {importing ? 'Extracting…' : 'Import from CV'}
            </button>
          </div>
        </div>
      )}

      {viewMode === 'list' && (
        <div className="flex flex-wrap gap-3 border-t border-gray-100 px-6 pb-6 pt-4 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setViewMode('form')}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-solid border-blue-600 bg-white px-5 py-2.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-400 dark:bg-transparent dark:text-blue-400 dark:hover:bg-blue-900/30"
          >
            <span className="material-icons text-base">edit</span> Edit Profile
          </button>
          <button
            type="button"
            onClick={() => navigate(`/job-profiles/${profileId}/cv`)}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <span className="material-icons text-base">picture_as_pdf</span> Generate CV
          </button>
        </div>
      )}
    </div>
  );
}
