import { Navigate, Route, Routes } from 'react-router-dom';

import { CvPage } from '../features/cv/CvPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { JobProfilesPage } from '../features/profile/JobProfilesPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { Layout } from './Layout';
import { ProtectedRoute } from './ProtectedRoute';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/job-profiles" replace />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/job-profiles" element={<JobProfilesPage />} />
          <Route path="/job-profiles/:id" element={<ProfilePage />} />
          <Route path="/job-profiles/:id/cv" element={<CvPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/job-profiles" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
