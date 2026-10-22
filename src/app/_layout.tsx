import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { FAVICON_DATA_URI } from '@/constants/favicon_b64';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const setFavicon = () => {
        // Remove any default expo favicon links
        const existingLinks = document.querySelectorAll("link[rel*='icon']");
        existingLinks.forEach((el) => el.remove());

        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        link.href = FAVICON_DATA_URI;
        document.head.appendChild(link);

        const shortcutLink = document.createElement('link');
        shortcutLink.rel = 'shortcut icon';
        shortcutLink.type = 'image/png';
        shortcutLink.href = FAVICON_DATA_URI;
        document.head.appendChild(shortcutLink);
      };
      setFavicon();
    }
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {Platform.OS === 'web' && (
        <Head>
          <title>Smart POS</title>
          <link rel="icon" type="image/png" href={FAVICON_DATA_URI} />
          <link rel="shortcut icon" type="image/png" href={FAVICON_DATA_URI} />
          <link rel="apple-touch-icon" href={FAVICON_DATA_URI} />
        </Head>
      )}
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
