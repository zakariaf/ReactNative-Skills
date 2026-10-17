// src/theme/palette.ts
// Written by write-palette.mjs from design/tokens.json ("color"). Change the token file, then rerun.
import type { ColorTokens, Palette } from './theme-types';

const LIGHT: ColorTokens = {
  background: '#F5F6F8', // neutral.97
  surface: '#FFFFFF', // neutral.100
  sunken: '#EBEDF1', // neutral.95
  text: '#15171C', // neutral.20
  textMuted: '#525866', // neutral.46
  primary: '#2156C8', // blue.49
  onPrimary: '#FFFFFF', // neutral.100
  border: '#7A8190', // neutral.60
  separator: '#15171C1F',
  shadow: '#15171C33',
  focus: '#1C4DB5', // blue.45
  danger: '#B42318', // red.50
  dangerSurface: '#FDECEA', // red.96
  success: '#13682C', // green.45
  warning: '#8A5300', // amber.49
  scrim: '#0F111599',
};

const DARK: ColorTokens = {
  background: '#0F1115', // neutral.18
  surface: '#1A1D23', // neutral.23
  sunken: '#15171C', // neutral.20
  text: '#F5F6F8', // neutral.97
  textMuted: '#A8AFBB', // neutral.75
  primary: '#8AB4FF', // blue.77
  onPrimary: '#0F1115', // neutral.18
  border: '#7A8190', // neutral.60
  separator: '#F5F6F824',
  shadow: '#00000066',
  focus: '#A8C7FF', // blue.83
  danger: '#FF8A80', // red.76
  dangerSurface: '#3A1715', // red.26
  success: '#6FD691', // green.80
  warning: '#F5B94A', // amber.82
  scrim: '#000000B3',
};

export const PALETTE: Palette = { light: LIGHT, dark: DARK };
