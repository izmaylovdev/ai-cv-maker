import { useEffect, useRef } from 'react';

import { environment } from '../../environments/environment';

type Props = {
  mode: 'signin' | 'signup';
  onCredential: (credential: string) => void;
};

export function GoogleSignInButton({ mode, onCredential }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !environment.googleClientId) return;

    const gsi = window.google?.accounts?.id;
    if (!gsi) return;

    el.innerHTML = '';
    gsi.initialize({
      client_id: environment.googleClientId,
      callback: (response: { credential: string }) => {
        onCredential(response.credential);
      },
    });
    gsi.renderButton(el, {
      theme: 'outline',
      size: 'large',
      width: '100%',
      text: mode === 'signin' ? 'signin_with' : 'signup_with',
    });

    return () => {
      el.innerHTML = '';
    };
  }, [mode, onCredential]);

  if (!environment.googleClientId) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="google-btn-container flex min-h-[44px] justify-center"
    />
  );
}
