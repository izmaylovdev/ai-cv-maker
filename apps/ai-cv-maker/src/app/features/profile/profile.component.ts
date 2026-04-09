import { Component, OnInit, inject } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ProfileService } from '../../core/profile.service';
import { AuthService } from '../../core/auth.service';
import { Profile } from '../../shared/models/profile.model';

const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

interface Tab { id: string; label: string; }

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private profileService = inject(ProfileService);
  private auth = inject(AuthService);
  private router = inject(Router);

  form!: FormGroup;
  loading = false;
  loadError = false;
  saving = false;
  activeTab = 'overview';
  notification: { message: string; type: 'success' | 'error' } | null = null;

  readonly skillLevels = SKILL_LEVELS;
  readonly tabs: Tab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'work', label: 'Work Experience' },
    { id: 'education', label: 'Education' },
    { id: 'skills', label: 'Skills' },
  ];

  ngOnInit() {
    this.buildForm();
    this.loadProfile();
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

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving = true;
    this.profileService.updateProfile(this.form.value).subscribe({
      next: () => {
        this.saving = false;
        this.showNotification('Profile saved successfully!', 'success');
      },
      error: () => {
        this.saving = false;
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

  private showNotification(message: string, type: 'success' | 'error') {
    this.notification = { message, type };
    setTimeout(() => (this.notification = null), 4000);
  }

  private buildForm() {
    this.form = this.fb.group({
      fullName: ['', Validators.required],
      title: ['', Validators.required],
      overview: ['', Validators.required],
      workExperiences: this.fb.array([]),
      educations: this.fb.array([]),
      skills: this.fb.array([]),
    });
  }

  private loadProfile() {
    this.loading = true;
    this.loadError = false;
    this.profileService.getProfile().pipe(
      finalize(() => (this.loading = false))
    ).subscribe({
      next: (profile: Profile) => {
        this.form.patchValue({
          fullName: profile.fullName,
          title: profile.title,
          overview: profile.overview,
        });
        profile.workExperiences?.forEach((w) =>
          this.workExperiences.push(this.createWorkExperienceGroup(w))
        );
        profile.educations?.forEach((e) =>
          this.educations.push(this.createEducationGroup(e))
        );
        profile.skills?.forEach((s) =>
          this.skills.push(this.createSkillGroup(s))
        );
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 401) {
          this.auth.logout();
        } else {
          this.loadError = true;
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
      description: [data?.description ?? '', Validators.required],
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
      level: [data?.level ?? 'Intermediate', Validators.required],
    });
  }
}
