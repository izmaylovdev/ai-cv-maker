import { Route } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  { path: '', redirectTo: '/job-profiles', pathMatch: 'full' },
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./auth/register/register.component').then((m) => m.RegisterComponent),
      },
    ],
  },
  {
    path: 'job-profiles',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/job-profiles/job-profiles.component').then((m) => m.JobProfilesComponent),
  },
  {
    path: 'job-profiles/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: 'job-profiles/:id/pdf',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/pdf-preview/pdf-preview-page.component').then((m) => m.PdfPreviewPageComponent),
  },
  {
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/chat/chat-page.component').then((m) => m.ChatPageComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'settings/usage',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/usage.component').then((m) => m.UsageComponent),
  },
  { path: '**', redirectTo: '/job-profiles' },
];
