import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ElementRef, signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, beforeEach, it, expect, vi } from 'vitest';

import { ProfileComponent } from './profile.component';
import { ProfileService } from './profile.service';
import { AuthService } from '../../auth/auth.service';
import { ThemeService } from '../../core/theme.service';
import { DialogService } from '../../shared/services/dialog.service';
import { NotifyService } from '../../shared/services/notify.service';

const PROFILE = {
  id: '1',
  name: 'Test',
  fullName: 'John Doe',
  title: 'Engineer',
  overview: 'Overview',
  location: '',
  contacts: { email: '', phone: '' },
  workExperiences: [],
  educations: [],
  skills: [],
  sectionOrder: ['workExperiences', 'educations', 'skills'],
};

describe('ProfileComponent — scroll sync', () => {
  // mainScrollTop and mainTop are shared mutable state so closures stay in sync.
  let mainScrollTop: number;
  let mainTop: number;
  let capturedHandler: (() => void) | undefined;
  let addListenerSpy: ReturnType<typeof vi.fn>;
  let removeListenerSpy: ReturnType<typeof vi.fn>;
  let mockMain: { scrollTop: number; getBoundingClientRect: () => { top: number }; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
  let mockDoc: { querySelector: (s: string) => unknown };

  // Creates a section ElementRef whose viewport top tracks mainScrollTop, simulating
  // how getBoundingClientRect changes as the user scrolls <main>.
  // absoluteOffset = section's distance from main's content top.
  function sectionRef(absoluteOffset: number): ElementRef<HTMLElement> {
    return {
      nativeElement: {
        getBoundingClientRect: () => ({ top: absoluteOffset - mainScrollTop + mainTop }),
      } as unknown as HTMLElement,
    };
  }

  function previewSectionEl(top: number): HTMLElement {
    return { getBoundingClientRect: () => ({ top }) } as unknown as HTMLElement;
  }

  function containerEl(top: number, scrollTop: number, scrollTo: ReturnType<typeof vi.fn>) {
    return { getBoundingClientRect: () => ({ top }), scrollTop, scrollTo } as unknown as HTMLElement;
  }

  beforeEach(async () => {
    mainScrollTop = 0;
    mainTop = 0;
    capturedHandler = undefined;
    addListenerSpy = vi.fn((_event: string, handler: () => void) => {
      capturedHandler = handler;
    });
    removeListenerSpy = vi.fn();

    mockMain = {
      get scrollTop() { return mainScrollTop; },
      getBoundingClientRect: () => ({ top: mainTop }),
      addEventListener: addListenerSpy,
      removeEventListener: removeListenerSpy,
    } as any;
    mockDoc = { querySelector: (s: string) => s === 'main' ? mockMain : null };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        // Real DOCUMENT — Angular's test renderer needs querySelectorAll and other DOM APIs.
        // We patch component.doc after creation instead (see createComponent).
        { provide: ProfileService, useValue: { getProfile: () => of(PROFILE), updateProfile: () => of({}) } },
        { provide: AuthService, useValue: { logout: vi.fn(), isLoggedIn: signal(true) } },
        { provide: ThemeService, useValue: { isDark: signal(false), toggle: vi.fn() } },
        { provide: DialogService, useValue: {
          openReorder: () => of(undefined),
          openOptimize: () => of(undefined),
          openDownloadCv: () => of(undefined),
        }},
        { provide: NotifyService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '1' } } } },
      ],
    })
    .overrideComponent(ProfileComponent, { set: { template: '<div></div>' } })
    .compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(ProfileComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit + ngAfterViewChecked (no leftPersonal in template, so sync not yet set up)
    // Patch doc so setupScrollSync returns our mock <main> without polluting the real document.
    (component as any).doc = mockDoc;
    return component;
  }

  // Manually wire the left-form section refs and trigger scroll sync setup.
  // Sections at fixed absolute offsets: personal=0, work=600, edu=1200, skills=1800.
  function initScrollSync(component: ProfileComponent) {
    (component as any).leftPersonal = sectionRef(0);
    (component as any).leftWork = sectionRef(600);
    (component as any).leftEdu = sectionRef(1200);
    (component as any).leftSkills = sectionRef(1800);
    (component as any).scrollSyncReady = false;
    component.ngAfterViewChecked();
  }

  // Wire a mock previewRef + previewContainer and return the scrollTo spy.
  function wirePreview(component: ProfileComponent, previewTop: number, containerTop: number, containerScrollTop: number) {
    const scrollTo = vi.fn();
    const getSectionElement = vi.fn().mockReturnValue(previewSectionEl(previewTop));
    (component as any).previewRef = { getSectionElement };
    (component as any).previewContainer = { nativeElement: containerEl(containerTop, containerScrollTop, scrollTo) };
    return { scrollTo, getSectionElement };
  }

  it('attaches a passive scroll listener to <main> when leftPersonal becomes available', () => {
    const component = createComponent();
    initScrollSync(component);

    expect(addListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    expect(capturedHandler).toBeDefined();
  });

  it('does not attach the listener more than once on repeated ngAfterViewChecked calls', () => {
    const component = createComponent();
    initScrollSync(component);
    component.ngAfterViewChecked();
    component.ngAfterViewChecked();

    expect(addListenerSpy).toHaveBeenCalledTimes(1);
  });

  it('removes the scroll listener on destroy', () => {
    const component = createComponent();
    initScrollSync(component);
    const [, attachedHandler] = addListenerSpy.mock.calls[0];

    component.ngOnDestroy();

    expect(removeListenerSpy).toHaveBeenCalledWith('scroll', attachedHandler);
  });

  describe('onScroll — active section detection', () => {
    // Active section thresholds (absoluteOffset - 100):
    //   personal:        0 - 100 = always active at scrollTop 0
    //   workExperiences: 600 - 100 = 500
    //   educations:      1200 - 100 = 1100
    //   skills:          1800 - 100 = 1700

    it('keeps personal active at scroll top and does not move the preview', () => {
      const component = createComponent();
      initScrollSync(component);
      const { scrollTo } = wirePreview(component, 300, 50, 0);

      mainScrollTop = 0;
      capturedHandler!();

      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('activates workExperiences once scrollTop reaches its threshold', () => {
      const component = createComponent();
      initScrollSync(component);
      const { scrollTo, getSectionElement } = wirePreview(component, 300, 50, 0);

      mainScrollTop = 500;
      capturedHandler!();

      expect(getSectionElement).toHaveBeenCalledWith('workExperiences');
      // container.scrollTo target = container.scrollTop + previewEl.top - container.top = 0 + 300 - 50 = 250
      expect(scrollTo).toHaveBeenCalledWith({ top: 250, behavior: 'smooth' });
    });

    it('activates educations once scrollTop reaches its threshold', () => {
      const component = createComponent();
      initScrollSync(component);
      const { getSectionElement } = wirePreview(component, 400, 50, 0);

      mainScrollTop = 1100;
      capturedHandler!();

      expect(getSectionElement).toHaveBeenCalledWith('educations');
    });

    it('activates skills once scrollTop reaches its threshold', () => {
      const component = createComponent();
      initScrollSync(component);
      const { getSectionElement } = wirePreview(component, 500, 50, 0);

      mainScrollTop = 1700;
      capturedHandler!();

      expect(getSectionElement).toHaveBeenCalledWith('skills');
    });

    it('does not scroll preview again when active section has not changed', () => {
      const component = createComponent();
      initScrollSync(component);
      const { scrollTo } = wirePreview(component, 300, 50, 0);

      mainScrollTop = 500; // activates workExperiences
      capturedHandler!();
      mainScrollTop = 700; // still workExperiences
      capturedHandler!();

      expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it('incorporates current container scrollTop into the scroll target', () => {
      const component = createComponent();
      initScrollSync(component);
      // container already scrolled 80px, preview el is at viewport y=200, container top at y=30
      const { scrollTo } = wirePreview(component, 200, 30, 80);

      mainScrollTop = 500; // activates workExperiences
      capturedHandler!();

      // target = containerScrollTop + previewEl.top - container.top = 80 + 200 - 30 = 250
      expect(scrollTo).toHaveBeenCalledWith({ top: 250, behavior: 'smooth' });
    });

    it('does not call scrollTo when the preview element is not found', () => {
      const component = createComponent();
      initScrollSync(component);
      const scrollTo = vi.fn();
      (component as any).previewRef = { getSectionElement: vi.fn().mockReturnValue(undefined) };
      (component as any).previewContainer = { nativeElement: containerEl(50, 0, scrollTo) };

      mainScrollTop = 500;
      capturedHandler!();

      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('does not throw when previewRef is absent', () => {
      const component = createComponent();
      initScrollSync(component);
      (component as any).previewRef = undefined;

      mainScrollTop = 500;
      expect(() => capturedHandler!()).not.toThrow();
    });

    it('handles missing section refs gracefully by skipping absent sections', () => {
      const component = createComponent();
      // Only wire personal and skills, skip work and edu
      (component as any).leftPersonal = sectionRef(0);
      (component as any).leftWork = undefined;
      (component as any).leftEdu = undefined;
      (component as any).leftSkills = sectionRef(1800);
      (component as any).scrollSyncReady = false;
      component.ngAfterViewChecked();

      const { getSectionElement } = wirePreview(component, 500, 50, 0);

      mainScrollTop = 1700; // past skills threshold
      capturedHandler!();

      expect(getSectionElement).toHaveBeenCalledWith('skills');
    });
  });
});
