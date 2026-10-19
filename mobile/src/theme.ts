import { StyleSheet } from 'react-native';

// Central design tokens.
//
// Glass look WITHOUT real backdrop blur (blur repaints every frame and is what
// made the old WebView build stutter). Instead we render a colourful gradient
// backdrop (see components/Background.tsx) and put TRANSLUCENT white panels on
// top with hairline light borders — a frosted-glass illusion that stays smooth.

export const colors = {
  // Deep base tint sitting under the gradient blobs (matches web #05060f).
  bg: '#05060f',
  // Elevated chrome (tab bar / sheets) — translucent so the backdrop shows through.
  bgElevated: 'rgba(20,20,38,0.72)',

  // Frosted glass panels (white at low alpha over the gradient).
  surface: 'rgba(255,255,255,0.055)',
  surface2: 'rgba(255,255,255,0.09)',
  // Slightly opaque inputs so text stays legible.
  input: 'rgba(255,255,255,0.06)',

  border: 'rgba(255,255,255,0.12)',
  borderStrong: 'rgba(255,255,255,0.2)',
  // Top sheen line that sells the glass edge.
  sheen: 'rgba(255,255,255,0.28)',

  text: '#f4f4ff',
  textDim: 'rgba(244,244,255,0.66)',
  textFaint: 'rgba(244,244,255,0.42)',

  primary: '#8b7bff', // violet
  primary2: '#ff6bd0', // pink
  accent: '#7c8cff',

  // Ring track — a light neutral so the ring is always visible on glass.
  track: 'rgba(255,255,255,0.14)',

  green: '#38d9a9',
  amber: '#ffd43b',
  red: '#ff6b6b',
};

// Brand gradient used on the logo, FAB and key accents.
export const brandGradient = ['#8b7bff', '#ff6bd0'] as const;

// Soft Aurora (neumorphic) theme. Surfaces share the page colour and get depth
// from a dark bottom-right + light top-left shadow pair (matches web globals.css).
export const neo = {
  bg: '#1b1d33',
  dark: '#0e0f1f',
  light: '#2a2d4c',
  hairline: 'rgba(255,255,255,0.035)',
};

const neoSurface = {
  backgroundColor: neo.bg,
  borderColor: neo.hairline,
  borderTopColor: neo.hairline,
};

export const neoStyles = StyleSheet.create({
  raised: {
    ...neoSurface,
    boxShadow: `6px 6px 14px ${neo.dark}, -6px -6px 14px ${neo.light}`,
  },
  raisedLg: {
    ...neoSurface,
    boxShadow: `9px 9px 20px ${neo.dark}, -7px -7px 18px ${neo.light}`,
  },
  raisedSm: {
    ...neoSurface,
    boxShadow: `3px 3px 7px ${neo.dark}, -3px -3px 7px ${neo.light}`,
  },
  pressed: {
    ...neoSurface,
    boxShadow: `inset 3px 3px 7px ${neo.dark}, inset -3px -3px 7px ${neo.light}`,
  },
});

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
};

export const font = {
  h1: 30,
  h2: 22,
  h3: 18,
  body: 15,
  small: 13,
  tiny: 11,
};
