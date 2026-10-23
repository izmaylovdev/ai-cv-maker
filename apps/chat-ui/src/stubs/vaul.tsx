// Build-time stand-in for `vaul`, the drawer Chat UI uses only for its PDF
// source preview. The real package injects an unscoped global <style> into the
// host page the moment it is imported (`[data-vaul-drawer]…`), which would break
// the widget's style isolation (see vite.config.mts `resolve.alias`).

import type { ReactNode } from 'react';

function part(displayName: string) {
  const Part = ({ children }: { children?: ReactNode }) => <>{children}</>;
  Part.displayName = displayName;
  return Part;
}

export const Drawer = {
  Root: part('Drawer.Root'),
  Trigger: part('Drawer.Trigger'),
  Portal: part('Drawer.Portal'),
  Overlay: () => null,
  Content: part('Drawer.Content'),
  Title: part('Drawer.Title'),
  Description: part('Drawer.Description'),
  Close: part('Drawer.Close'),
};
