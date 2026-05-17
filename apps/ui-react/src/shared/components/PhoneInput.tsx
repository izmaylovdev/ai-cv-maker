import type { InputHTMLAttributes } from 'react';

function formatDigits(digits: string): string {
  if (!digits) return '';
  let result = '+' + digits.slice(0, Math.min(2, digits.length));
  if (digits.length > 2) result += ' (' + digits.slice(2, Math.min(5, digits.length));
  if (digits.length >= 5) result += ') ' + digits.slice(5, Math.min(7, digits.length));
  if (digits.length >= 7) result += '-' + digits.slice(7, Math.min(10, digits.length));
  if (digits.length >= 10) result += '-' + digits.slice(10, 12);
  return result;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function PhoneInput({ value, onValueChange, onKeyDown, ...rest }: Props) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
    onValueChange(formatDigits(digits));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (
      e.key === 'Backspace' &&
      input.selectionStart === input.selectionEnd &&
      (input.selectionStart ?? 0) > 0
    ) {
      const pos = input.selectionStart ?? 0;
      if (/\D/.test(input.value[pos - 1] ?? '')) {
        e.preventDefault();
        const newPos = pos - 1;
        input.setSelectionRange(newPos, newPos);
      }
    }
    onKeyDown?.(e);
  };

  return (
    <input
      {...rest}
      type="tel"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
}
