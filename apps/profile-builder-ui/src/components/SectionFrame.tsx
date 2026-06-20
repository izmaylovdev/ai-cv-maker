import { ReactNode, useState } from 'react';

interface SectionFrameProps {
  heading: string;
  hasContent: boolean;
  isFirst: boolean;
  isLast: boolean;
  onHeadingChange: (heading: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  /** Drag handlers for the section-level reorder (HTML5 DnD). */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  children: ReactNode;
}

// Per-section document chrome: an inline-editable heading rendered as a CV-style
// section label, plus reorder/remove controls that stay out of the way (revealed
// on hover) so the editor reads like a document, not a form (spec §7.3).
export function SectionFrame({
  heading,
  hasContent,
  isFirst,
  isLast,
  onHeadingChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  dragHandleProps,
  children,
}: SectionFrameProps) {
  const [confirming, setConfirming] = useState(false);

  const handleRemoveClick = () => {
    if (hasContent) {
      setConfirming(true);
    } else {
      onRemove();
    }
  };

  return (
    <section className="pb-section" data-section>
      <button
        type="button"
        className="pb-section__drag"
        aria-label="Reorder section (drag)"
        title="Drag to reorder"
        {...dragHandleProps}
      >
        ⠿
      </button>

      <div className="pb-section__tools">
        <button type="button" aria-label="Move section up" disabled={isFirst} onClick={onMoveUp}>
          ↑
        </button>
        <button type="button" aria-label="Move section down" disabled={isLast} onClick={onMoveDown}>
          ↓
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="pb-tool-danger"
              aria-label="Confirm remove section"
              onClick={onRemove}
            >
              Remove?
            </button>
            <button
              type="button"
              aria-label="Cancel remove section"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="pb-tool-danger"
            aria-label="Remove section"
            onClick={handleRemoveClick}
          >
            ✕
          </button>
        )}
      </div>

      <input
        className="pb-section__heading"
        aria-label="Section heading"
        value={heading}
        placeholder="Section heading"
        onChange={(e) => onHeadingChange(e.target.value)}
      />

      <div className="pb-section__body">{children}</div>
    </section>
  );
}
