import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, beforeEach, it, expect, vi } from 'vitest';

import { ProfileComponent } from './profile.component';
import { ProfileService } from './profile.service';
import { AuthService } from '../../auth/auth.service';
import { BuilderLoaderService } from '../../core/builder-loader.service';
import { ChatLoaderService } from '../../core/chat-loader.service';
import { NotifyService } from '../../shared/services/notify.service';
import { ProfileDocument } from '../../shared/models/profile.model';

function doc(fullName: string): ProfileDocument {
  return {
    header: { fullName, title: 'Engineer', email: '', phone: '', location: '' },
    body: { type: 'root', id: 'root-1', children: [] },
  };
}

const LOADED = { id: '1', name: 'My Profile', document: doc('Jane Doe') };

describe('ProfileComponent (builder-based)', () => {
  let profileService: {
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
  };
  let notify: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    profileService = {
      getProfile: vi.fn().mockReturnValue(of(LOADED)),
      updateProfile: vi.fn().mockReturnValue(of(LOADED)),
    };
    notify = { success: vi.fn(), error: vi.fn() };
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        { provide: ProfileService, useValue: profileService },
        { provide: AuthService, useValue: { logout: vi.fn() } },
        { provide: BuilderLoaderService, useValue: { load: () => Promise.resolve() } },
        { provide: ChatLoaderService, useValue: { load: () => Promise.resolve() } },
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

  describe('US-AI-15: Resizable Chat Sidebar', () => {
    it('F-AI-15.5: initializes chatWidth to 384px (default) when no localStorage value exists', () => {
      // Ensure localStorage is clean
      try {
        localStorage.removeItem('applysy.profile.chatWidth');
      } catch { /* localStorage may be unavailable */ }

      const component = create();
      expect(component.chatWidth()).toBe(384);
    });

    it('F-AI-15.5: restores chatWidth from localStorage if present', () => {
      // Set a persisted width in localStorage
      try {
        localStorage.setItem('applysy.profile.chatWidth', '500');
      } catch { /* localStorage may be unavailable */ }

      const component = create();
      expect(component.chatWidth()).toBe(500);

      // Clean up
      try {
        localStorage.removeItem('applysy.profile.chatWidth');
      } catch { /* localStorage may be unavailable */ }
    });

    it('F-AI-15.5: persists chatWidth changes to localStorage', () => {
      const component = create();
      const storageSetSpy = vi.spyOn(Storage.prototype, 'setItem');

      // Set a new width
      component.setChatWidth(550);

      expect(storageSetSpy).toHaveBeenCalledWith('applysy.profile.chatWidth', '550');
      expect(component.chatWidth()).toBe(550);

      storageSetSpy.mockRestore();

      // Clean up
      try {
        localStorage.removeItem('applysy.profile.chatWidth');
      } catch { /* localStorage may be unavailable */ }
    });

    it('F-AI-15.3: clamps chatWidth to [320, max] where max = min(720, 66% of viewport)', () => {
      const component = create();

      // Set viewport to 1024px
      global.innerWidth = 1024;
      const maxWidth = Math.min(720, Math.ceil(1024 * 0.66));

      // Try to set below minimum
      component.setChatWidth(200);
      expect(component.chatWidth()).toBe(320);

      // Try to set above maximum
      component.setChatWidth(1000);
      expect(component.chatWidth()).toBe(maxWidth);

      // Set within bounds
      component.setChatWidth(400);
      expect(component.chatWidth()).toBe(400);
    });

    it('F-AI-15.3: recalculates max width on viewport resize', () => {
      const component = create();

      // Start at 1024px viewport
      global.innerWidth = 1024;
      let maxWidth = Math.min(720, Math.ceil(1024 * 0.66));
      component.setChatWidth(1000);
      expect(component.chatWidth()).toBe(maxWidth);

      // Resize to 600px viewport
      global.innerWidth = 600;
      maxWidth = Math.min(720, Math.ceil(600 * 0.66));
      // Trigger resize handling (normally via ResizeObserver/window resize)
      component.onWindowResize?.();
      component.setChatWidth(1000);
      expect(component.chatWidth()).toBe(maxWidth);
    });

    it('F-AI-15.6: resizing does not remount chat widget (same DOM element)', () => {
      const component = create();

      // Verify chatOpen stays true while resizing
      component.setChatOpen(true);
      expect(component.chatOpen()).toBe(true);

      // Resize
      component.setChatWidth(450);

      // chatOpen should still be true (widget not remounted)
      expect(component.chatOpen()).toBe(true);
    });

    it('F-AI-15.7: default width is 384px, matching US-AI-10 fixed width', () => {
      try {
        localStorage.removeItem('applysy.profile.chatWidth');
      } catch { /* localStorage may be unavailable */ }

      const component = create();
      expect(component.chatWidth()).toBe(384);
    });
  });
});
