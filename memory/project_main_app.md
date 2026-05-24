---
name: project-main-app
description: The Angular app (apps/ui-angular) is the primary/main UI, not the React app (apps/ui-react). Mobile UI fixes and feature work should target the Angular app first.
metadata:
  type: project
---

The Angular app (`apps/ui-angular`) is the main production UI.

**Why:** User explicitly stated "Angular app is the main one" when mobile fixes were accidentally applied to the React app first.

**How to apply:** When the user asks for UI changes, default to `apps/ui-angular`. The React app (`apps/ui-react`) exists but is not the primary focus.
