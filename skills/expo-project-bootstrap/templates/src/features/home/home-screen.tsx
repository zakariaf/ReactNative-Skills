// src/features/home/home-screen.tsx: the starter screen of a new app, a pure view. It shows no text
// yet: words reach the screen through the message catalogs (i18n-strings-and-catalogs), never as
// literal strings, and colours through the theme (design-system-structure). The first real feature
// (scaffold-feature-screen) replaces it.
import { StyleSheet, View } from 'react-native';

export function HomeScreen(): React.JSX.Element {
  return <View style={styles.screen} testID="home.screen" />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
