import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { createAuthBroadcast } from '@ai-cv-maker/auth';

import App from './app/app';
import { store } from './app/store';
import { logout } from './features/auth/authSlice';

// Sync logout across tabs: if the Angular shell (or another React tab) logs out,
// dispatch logout here too so the Redux store and ProtectedRoute react immediately.
const authBroadcast = createAuthBroadcast();
authBroadcast.onLogout(() => store.dispatch(logout()));

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
