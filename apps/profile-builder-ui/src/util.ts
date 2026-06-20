import { DocumentSection } from './model';

/** Whether a section holds user content (drives remove-confirmation, §F-EDIT-12.2). */
export function sectionHasContent(section: DocumentSection): boolean {
  switch (section.template) {
    case 'free-form':
      return section.body.trim().length > 0;
    case 'list':
      return section.items.some((it) => it.text.trim().length > 0);
    default:
      return section.items.some(
        (it) => it.title.trim() || it.description.trim() || it.dates.trim()
      );
  }
}

/** Immutably move the element at `from` to `to` within an array. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
