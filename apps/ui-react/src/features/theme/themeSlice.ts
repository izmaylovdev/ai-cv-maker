import { createSlice } from '@reduxjs/toolkit';

function readTheme(): boolean {
  const saved = localStorage.getItem('theme');
  if (saved) return saved === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const initialState = {
  isDark: readTheme(),
};

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    toggle(state) {
      state.isDark = !state.isDark;
      localStorage.setItem('theme', state.isDark ? 'dark' : 'light');
    },
  },
});

export const { toggle } = themeSlice.actions;
export default themeSlice.reducer;
