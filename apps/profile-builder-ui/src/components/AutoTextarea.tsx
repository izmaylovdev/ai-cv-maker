import {
  TextareaHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

// A textarea that grows with its content so it reads like a paragraph in a
// document rather than a fixed, scrollable form field. Height is recomputed both
// when the value changes and when the field's width changes (via ResizeObserver),
// so it stays correct even if the first measurement happens before layout settles.
export function AutoTextarea({
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(resize, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      // Only react to width changes; reacting to our own height change loops.
      if (width !== lastWidth) {
        lastWidth = width;
        resize();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <textarea ref={ref} rows={1} value={value} {...rest} />;
}
