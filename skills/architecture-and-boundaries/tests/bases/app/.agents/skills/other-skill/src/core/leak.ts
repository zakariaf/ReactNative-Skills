import { View } from 'react-native';
import { readFileSync } from 'node:fs';

export const leak = [View, readFileSync];
