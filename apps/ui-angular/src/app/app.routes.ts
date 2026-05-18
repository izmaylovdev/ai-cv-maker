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
    path: 'job-profiles/:id/cv',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/cv/cv.component').then((m) => m.CvComponent),
  },
  { path: '**', redirectTo: '/job-profiles' },
];
