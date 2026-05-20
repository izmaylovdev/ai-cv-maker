import { Component, AfterViewChecked, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ProfileService } from './profile.service';
import { AuthService } from '../../auth/auth.service';
import { ThemeService } from '../../core/theme.service';
import { DialogService } from '../../shared/services/dialog.service';
import { NotifyService } from '../../shared/services/notify.service';
import { Education, Profile, WorkExperience } from '../../shared/models/profile.model';
import { PhoneMaskDirective } from '../../shared/directives/phone-mask.directive';
import { ProfilePreviewComponent } from '../../shared/components/profile-preview/profile-preview.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule, PhoneMaskDirective, DragDropModule, ProfilePreviewComponent],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit, AfterViewChecked, OnDestroy {
  private fb = inject(FormBuilder);
  private profileService = inject(ProfileService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private dialogs = inject(DialogService);
  private notify = inject(NotifyService);
  private doc = inject(DOCUMENT);
  readonly router = inject(Router);
  readonly theme = inject(ThemeService);

  profileId = '';
  form!: FormGroup;
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly optimizing = signal(false);

  readonly sectionOrder = signal<string[]>(['workExperiences', 'educations', 'skills']);
  readonly reorderOpen = signal(false);
  readonly reorderDraft = signal<string[]>([]);

  private readonly sectionLabels: Record<string, string> = {
    workExperiences: 'Work Experience',
    educations: 'Education',
    skills: 'Skills',
  };

  @ViewChild('leftPersonal') private leftPersonal?: ElementRef<HTMLElement>;
  @ViewChild('leftWork') private leftWork?: ElementRef<HTMLElement>;
  @ViewChild('leftEdu') private leftEdu?: ElementRef<HTMLElement>;
  @ViewChild('leftSkills') private leftSkills?: ElementRef<HTMLElement>;
  @ViewChild('previewContainer') private previewContainer?: ElementRef<HTMLElement>;
  @ViewChild(ProfilePreviewComponent) private previewRef?: ProfilePreviewComponent;

  private lastActiveSection = 'personal';
  private scrollSyncReady = false;
  private scrollUnsubscribe?: () => void;

  ngOnInit() {
    this.profileId = this.route.snapshot.paramMap.get('id') ?? '';
    this.buildForm();
    this.loadProfile();
  }

  ngAfterViewChecked() {
    if (!this.scrollSyncReady && this.leftPersonal?.nativeElement) {
      this.scrollSyncReady = true;
      this.setupScrollSync();
    }
  }

  ngOnDestroy() {
    this.scrollUnsubscribe?.();
  }

  private setupScrollSync() {
    const scrollRoot = this.doc.querySelector('main');
    if (!scrollRoot) return;

    const onScroll = () => {
      const sections = [
        { el: this.leftPersonal?.nativeElement, key: 'personal' },
        { el: this.leftWork?.nativeElement, key: 'workExperiences' },
        { el: this.leftEdu?.nativeElement, key: 'educations' },
        { el: this.leftSkills?.nativeElement, key: 'skills' },
      ].filter((s): s is { el: HTMLElement; key: string } => s.el != null);

      const scrollTop = scrollRoot.scrollTop;
      const rootTop = scrollRoot.getBoundingClientRect().top;

      let activeKey = sections[0]?.key ?? this.lastActiveSection;
      for (const { el, key } of sections) {
        const elAbsTop = el.getBoundingClientRect().top - rootTop + scrollTop;
        if (scrollTop >= elAbsTop - 100) {
          activeKey = key;
        }
      }

      if (activeKey !== this.lastActiveSection) {
        this.lastActiveSection = activeKey;
        const previewEl = this.previewRef?.getSectionElement(activeKey);
        const container = this.previewContainer?.nativeElement;
        if (previewEl && container) {
          const elTop = previewEl.getBoundingClientRect().top;
          const containerTop = container.getBoundingClientRect().top;
          container.scrollTo({ top: container.scrollTop + elTop - containerTop, behavior: 'smooth' });
        }
      }
    };

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    this.scrollUnsubscribe = () => scrollRoot.removeEventListener('scroll', onScroll);
  }

  get workExperiences() {
    return this.form.get('workExperiences') as FormArray;
  }

  get educations() {
    return this.form.get('educations') as FormArray;
  }

  get skills() {
    return this.form.get('skills') as FormArray;
  }

  addWorkExperience() {
    this.workExperiences.push(this.createWorkExperienceGroup());
  }

  removeWorkExperience(i: number) {
    this.workExperiences.removeAt(i);
  }

  addEducation() {
    this.educations.push(this.createEducationGroup());
  }

  removeEducation(i: number) {
    this.educations.removeAt(i);
  }

  addSkill() {
    this.skills.push(this.createSkillGroup());
  }

  removeSkill(i: number) {
    this.skills.removeAt(i);
  }

  dropSkill(event: CdkDragDrop<string[]>) {
    const control = this.skills.at(event.previousIndex);
    this.skills.removeAt(event.previousIndex);
    this.skills.insert(event.currentIndex, control);
  }

  openReorderDialog() {
    this.dialogs.openReorder(this.sectionOrder()).subscribe(result => {
      if (result) this.sectionOrder.set(result);
    });
  }

  openOptimizeDialog() {
    this.dialogs.openOptimize().subscribe(message => {
      if (!message) return;
      this.optimizing.set(true);
      this.profileService.optimizeProfile(this.profileId, message).subscribe({
        next: (result) => {
          this.form.patchValue({ title: result.title, overview: result.overview });
          this.workExperiences.clear();
          result.workExperiences.forEach((w) => this.workExperiences.push(this.createWorkExperienceGroup(w)));
          this.skills.clear();
          result.skills.forEach((s) => this.skills.push(this.createSkillGroup(s)));
          this.optimizing.set(false);
          this.notify.success('Profile optimized! Review the changes and save when ready.');
        },
        error: () => {
          this.optimizing.set(false);
          this.notify.error('Failed to optimize profile. Please try again.');
        },
      });
    });
  }

  openPdfDialog() {
    this.dialogs.openDownloadCv().subscribe(notes => {
      if (notes === undefined) return;
      const fullName = this.form.get('fullName')?.value ?? '';
      const jobTitle = this.form.get('title')?.value ?? '';
      this.router.navigate(['/job-profiles', this.profileId, 'pdf'], {
        state: { notes, title: `${fullName} — ${jobTitle}` },
      });
    });
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.value;
    const payload = {
      ...raw,
      location: (raw.location as string)?.trim() || null,
      sectionOrder: this.sectionOrder(),
      workExperiences: (raw.workExperiences as WorkExperience[] ?? []).map((w) => ({
        ...w,
        endDate: w.endDate || null,
      })),
      educations: (raw.educations as Education[] ?? []).map((e) => ({
        ...e,
        endYear: e.endYear || null,
      })),
    };
    this.saving.set(true);
    this.profileService.updateProfile(this.profileId, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.success('Profile saved successfully!');
      },
      error: () => {
        this.saving.set(false);
        this.notify.error('Failed to save profile.');
      },
    });
  }

  retryLoad() {
    this.workExperiences.clear();
    this.educations.clear();
    this.skills.clear();
    this.loadProfile();
  }

  get profilePreview(): Profile | null {
    if (!this.form) return null;
    return { id: '', ...this.form.value, sectionOrder: this.sectionOrder() } as Profile;
  }

  get profileName(): string {
    return this.form?.get('name')?.value || 'Job Profile';
  }

  private buildForm() {
    this.form = this.fb.group({
      name: [''],
      fullName: ['', Validators.required],
      title: ['', Validators.required],
      overview: ['', Validators.required],
      location: [''],
      contacts: this.fb.group({
        email: ['', [Validators.email]],
        phone: [''],
      }),
      workExperiences: this.fb.array([]),
      educations: this.fb.array([]),
      skills: this.fb.array([]),
    });
  }

  private loadProfile() {
    this.loading.set(true);
    this.loadError.set(false);
    this.profileService.getProfile(this.profileId).pipe(
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (profile: Profile) => {
        this.form.patchValue({
          name: profile.name ?? '',
          fullName: profile.fullName,
          title: profile.title,
          overview: profile.overview,
          location: profile.location ?? '',
          contacts: {
            email: profile.contacts?.email ?? '',
            phone: profile.contacts?.phone ?? '',
          },
        });
        const sortedWork = [...(profile.workExperiences ?? [])].sort((a, b) => {
          const aEnd = a.endDate ? new Date(a.endDate).getTime() : Infinity;
          const bEnd = b.endDate ? new Date(b.endDate).getTime() : Infinity;
          if (bEnd !== aEnd) return bEnd - aEnd;
          return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
        });
        sortedWork.forEach((w) => this.workExperiences.push(this.createWorkExperienceGroup(w)));

        const sortedEdu = [...(profile.educations ?? [])].sort((a, b) => {
          const aEnd = a.endYear ?? Infinity;
          const bEnd = b.endYear ?? Infinity;
          if (bEnd !== aEnd) return bEnd - aEnd;
          return b.startYear - a.startYear;
        });
        sortedEdu.forEach((e) => this.educations.push(this.createEducationGroup(e)));
        profile.skills?.forEach((s) => this.skills.push(this.createSkillGroup(s)));
        if (profile.sectionOrder?.length) {
          this.sectionOrder.set(profile.sectionOrder);
        }
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 401) {
          this.auth.logout();
        } else {
          this.loadError.set(true);
        }
      },
    });
  }

  private createWorkExperienceGroup(data?: Partial<Profile['workExperiences'][0]>) {
    return this.fb.group({
      company: [data?.company ?? '', Validators.required],
      role: [data?.role ?? '', Validators.required],
      startDate: [data?.startDate ?? '', Validators.required],
      endDate: [data?.endDate ?? ''],
      description: [data?.description ?? ''],
    });
  }

  private createEducationGroup(data?: Partial<Profile['educations'][0]>) {
    return this.fb.group({
      institution: [data?.institution ?? '', Validators.required],
      degree: [data?.degree ?? '', Validators.required],
      field: [data?.field ?? '', Validators.required],
      startYear: [data?.startYear ?? '', [Validators.required, Validators.min(1950), Validators.max(2100)]],
      endYear: [data?.endYear ?? ''],
    });
  }

  private createSkillGroup(data?: Partial<Profile['skills'][0]>) {
    return this.fb.group({
      name: [data?.name ?? '', Validators.required],
    });
  }
}
