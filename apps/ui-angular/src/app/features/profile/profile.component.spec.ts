import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, beforeEach, it, expect, vi } from 'vitest';

import { ProfileComponent } from './profile.component';
import { ProfileService } from './profile.service';
import { AuthService } from '../../auth/auth.service';
import { BuilderLoaderService } from '../../core/builder-loader.service';
import { NotifyService } from '../../shared/services/notify.service';
import { ProfileDocument } from '../../shared/models/profile.model';

function doc(fullName: string): ProfileDocument {
  return {
    header: { fullName, title: 'Engineer', email: '', phone: '', location: '' },
    sections: [],
  };
}

const LOADED = { id: '1', name: 'My Profile', document: doc('Jane Doe') };

describe('ProfileComponent (builder-based)', () => {
  let profileService: {
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    optimizeProfile: ReturnType<typeof vi.fn>;
    extractFromCv: ReturnType<typeof vi.fn>;
  };
  let notify: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    profileService = {
      getProfile: vi.fn().mockReturnValue(of(LOADED)),
      updateProfile: vi.fn().mockReturnValue(of(LOADED)),
      optimizeProfile: vi.fn().mockReturnValue(of({ document: doc('Optimized') })),
      extractFromCv: vi.fn().mockReturnValue(of({ name: 'From CV', document: doc('From CV') })),
    };
    notify = { success: vi.fn(), error: vi.fn() };
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        { provide: ProfileService, useValue: profileService },
        { provide: AuthService, useValue: { logout: vi.fn() } },
        { provide: BuilderLoaderService, useValue: { load: () => Promise.resolve() } },
        { provide: NotifyService, useValue: notify },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '1' } } } },
      ],
    })
      // Avoid rendering the unknown custom element; we drive logic directly.
      .overrideComponent(ProfileComponent, { set: { template: '<div></div>' } })
      .compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return component;
  }

  it('loads the profile and exposes its name', () => {
    const component = create();
    expect(profileService.getProfile).toHaveBeenCalledWith('1');
    expect(component.profileName()).toBe('My Profile');
  });

  it('shows an error state when loading fails', () => {
    profileService.getProfile.mockReturnValue(throwError(() => ({ status: 500 })));
    const component = create();
    expect(component.loadError()).toBe(true);
  });

  it('saves the current document with the profile name', () => {
    const component = create();
    component.onDocumentChange(new CustomEvent('documentchange', { detail: doc('Edited') }));
    component.save();
    expect(profileService.updateProfile).toHaveBeenCalledWith('1', {
      name: 'My Profile',
      document: doc('Edited'),
    });
    expect(notify.success).toHaveBeenCalled();
  });

  it('optimize loads the returned document and notifies', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Senior role');
    const component = create();
    component.optimize();
    expect(profileService.optimizeProfile).toHaveBeenCalledWith('1', 'Senior role');
    // The returned document becomes the source of truth for the next save.
    component.save();
    expect(profileService.updateProfile).toHaveBeenCalledWith('1', {
      name: 'My Profile',
      document: doc('Optimized'),
    });
  });

  it('optimize is a no-op when the prompt is cancelled', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const component = create();
    component.optimize();
    expect(profileService.optimizeProfile).not.toHaveBeenCalled();
  });

  it('extract imports the document and adopts the suggested name', () => {
    const component = create();
    const file = new File(['x'], 'cv.pdf');
    const input = { files: [file], value: '' } as unknown as HTMLInputElement;
    component.onExtractFileChange({ target: input } as unknown as Event);
    expect(profileService.extractFromCv).toHaveBeenCalledWith('1', file);
    expect(component.profileName()).toBe('From CV');
  });

  it('openPdf navigates with the current document as draft state', () => {
    const component = create();
    component.onDocumentChange(new CustomEvent('documentchange', { detail: doc('Edited Name') }));
    component.openPdf();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/job-profiles', '1', 'pdf'],
      expect.objectContaining({
        state: expect.objectContaining({
          draft: { name: 'My Profile', document: doc('Edited Name') },
        }),
      }),
    );
  });
});
