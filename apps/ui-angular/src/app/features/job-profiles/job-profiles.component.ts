import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ProfileService } from '../profile/profile.service';
import { JobProfileListItem } from '../../shared/models/profile.model';

@Component({
  selector: 'app-job-profiles',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './job-profiles.component.html',
})
export class JobProfilesComponent implements OnInit {
  private profileService = inject(ProfileService);
  readonly router = inject(Router);

  readonly profiles = signal<JobProfileListItem[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly creating = signal(false);
  readonly saving = signal(false);
  readonly deletingId = signal<string | null>(null);
  readonly cvFile = signal<File | null>(null);
  newName = '';

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.loadError.set(false);
    this.profileService.listProfiles().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (data) => this.profiles.set(data),
      error: () => this.loadError.set(true),
    });
  }

  toggleCreate() {
    this.creating.set(!this.creating());
    if (!this.creating()) {
      this.newName = '';
      this.cvFile.set(null);
    }
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.cvFile.set(file);
    input.value = '';
  }

  clearFile() {
    this.cvFile.set(null);
  }

  create() {
    const name = this.newName.trim() || 'My Profile';
    const file = this.cvFile();
    this.saving.set(true);
    this.profileService.createProfile(name).subscribe({
      next: (profile) => {
        if (!file) {
          this.saving.set(false);
          this.router.navigate(['/job-profiles', profile.id]);
          return;
        }
        this.profileService.extractFromCv(profile.id, file).subscribe({
          next: (extracted) => {
            this.profileService.updateProfile(profile.id, { ...extracted, name }).pipe(
              finalize(() => this.saving.set(false))
            ).subscribe({
              next: () => this.router.navigate(['/job-profiles', profile.id]),
              error: () => this.router.navigate(['/job-profiles', profile.id]),
            });
          },
          error: () => {
            this.saving.set(false);
            this.router.navigate(['/job-profiles', profile.id]);
          },
        });
      },
      error: () => this.saving.set(false),
    });
  }

  navigateToCv(id: string, event: Event) {
    event.stopPropagation();
    this.router.navigate(['/job-profiles', id, 'cv']);
  }

  subtitle(profile: JobProfileListItem): string {
    return [profile.fullName, profile.title].filter((s) => !!s).join(' · ');
  }

  delete(id: string, event: Event) {
    event.stopPropagation();
    this.deletingId.set(id);
    this.profileService.deleteProfile(id).pipe(finalize(() => this.deletingId.set(null))).subscribe({
      next: () => this.profiles.update((list) => list.filter((p) => p.id !== id)),
      error: () => {},
    });
  }
}
