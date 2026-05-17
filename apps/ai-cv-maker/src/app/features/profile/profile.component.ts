import { Component, OnInit, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ProfileService } from '../../core/profile.service';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { Profile } from '../../shared/models/profile.model';
import { PhoneMaskDirective } from '../../shared/directives/phone-mask.directive';
import { ProfilePreviewComponent } from '../../shared/components/profile-preview/profile-preview.component';

interface Tab { id: string; label: string; }

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule, PhoneMaskDirective, DragDropModule, ProfilePreviewComponent],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private profileService = inject(ProfileService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly theme = inject(ThemeService);

  form!: FormGroup;
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly activeTab = signal('overview');
  readonly notification = signal<{ message: string; type: 'success' | 'error' } | null>(null);

  readonly viewMode = signal<'form' | 'list'>('form');
  readonly tabs: Tab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'work', label: 'Work Experience' },
    { id: 'education', label: 'Education' },
    { id: 'skills', label: 'Skills' },
  ];

  readonly tabIds = this.tabs.map(t => t.id);

  ngOnInit() {
    this.buildForm();
    this.loadProfile();
    this.route.fragment.subscribe(fragment => {
      const id = fragment ?? '';
      this.activeTab.set(this.tabIds.includes(id) ? id : 'overview');
    });
  }

  setTab(id: string) {
    this.router.navigate([], { fragment: id, replaceUrl: true });
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

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.value;
    const payload = {
      ...raw,
      location: (raw.location as string)?.trim() || null,
      workExperiences: (raw.workExperiences ?? []).map((w: any) => ({
        ...w,
        endDate: w.endDate || null,
      })),
      educations: (raw.educations ?? []).map((e: any) => ({
        ...e,
        endYear: e.endYear || null,
      })),
    };
    this.saving.set(true);
    this.profileService.updateProfile(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.showNotification('Profile saved successfully!', 'success');
      },
      error: () => {
        this.saving.set(false);
        this.showNotification('Failed to save profile.', 'error');
      },
    });
  }

  retryLoad() {
    this.workExperiences.clear();
    this.educations.clear();
    this.skills.clear();
    this.loadProfile();
  }

  goToGenerate() {
    this.router.navigate(['/cv']);
  }

  get profilePreview(): Profile | null {
    if (!this.form) return null;
    return { id: '', ...this.form.value } as Profile;
  }

  private showNotification(message: string, type: 'success' | 'error') {
    this.notification.set({ message, type });
    setTimeout(() => this.notification.set(null), 4000);
  }

  private buildForm() {
    this.form = this.fb.group({
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
    this.profileService.getProfile().pipe(
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (profile: Profile) => {
        this.form.patchValue({
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
        profile.skills?.forEach((s) =>
          this.skills.push(this.createSkillGroup(s))
        );
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
