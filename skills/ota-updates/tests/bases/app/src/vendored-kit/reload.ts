import * as Updates from 'expo-updates';

export const reload = (): Promise<void> => Updates.reloadAsync();
