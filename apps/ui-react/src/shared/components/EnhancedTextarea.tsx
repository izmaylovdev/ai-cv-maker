import { useRef, useState } from 'react';
import { enhanceField } from '../../lib/profileApi';

type Props = {
  value: string;
  onChange: (value: string) => void;
  fieldPurpose: string;
  profileId: string;
  token: string;
  onError: (message: string) => void;
  rows?: number;
  className?: string;
  placeholder?: string;
};

export function EnhancedTextarea({
  value,
  onChange,
  fieldPurpose,
  profileId,
  token,
  onError,
  rows = 3,
  className = '',
  placeholder,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleEnhance = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!value.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const enhanced = await enhanceField(token, profileId, value, fieldPurpose);
      onChange(enhanced);
    } catch {
      onError('Failed to enhance text. Please try again.');
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div className="relative">
      <textarea
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (e.relatedTarget !== buttonRef.current) {
            setFocused(false);
          }
        }}
      />
      {(focused || enhancing) && (
        <div className="group absolute bottom-4 right-2">
          <button
            ref={buttonRef}
            type="button"
            disabled={enhancing || !value.trim()}
            onClick={(e) => void handleEnhance(e)}
            onMouseDown={(e) => e.preventDefault()}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-purple-500 transition-all hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-purple-400 dark:hover:text-purple-300"
          >
            {enhancing ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-purple-500 border-t-transparent dark:border-purple-400" />
            ) : (
              <span className="material-icons text-sm leading-none">auto_fix_high</span>
            )}
          </button>
          {!enhancing && (
            <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-gray-700">
              Enhance with AI
            </div>
          )}
        </div>
      )}
    </div>
  );
}
