import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useLocales } from 'expo-localization';

import * as GH from './src/github';
import * as G from './src/google';
import { computeStats, ago, dayLabel, hm, num, kindOf } from './src/stats';
import { arrayBufferToBase64, wordHtml, sheetHtml, textHtml, utf8Decode, diffHtml } from './src/viewer';
import { FocusActivity, pulse, loadSeen, saveSeen } from './src/island';
import { t, lang, locale, resolveLanguage, setLanguage, loadPrefs, savePrefs, viewerLabels } from './src/i18n';

const GRAD = ['#6c5cff', '#a35cf6', '#ec62be'];
const KIND_ICON = { auto: '💾', star: '⭐', rescue: '⚡', restore: '↩️', merge: '🤝' };
const TYPE = {
  word: { label: 'DOC', colors: ['#2b7cd3', '#185abd'] },
  sheet: { label: 'XLS', colors: ['#21a366', '#107c41'] },
  slides: { label: 'PPT', colors: ['#ed6c47', '#c43e1c'] },
  pdf: { label: 'PDF', colors: ['#f15642', '#c9302c'] },
  text: { label: 'TXT', colors: ['#8b8aa6', '#5f5d7a'] },
  image: { label: 'IMG', colors: ['#f59e0b', '#d97706'] },
  other: { label: 'FILE', colors: ['#a3a1bd', '#7b7998'] },
};
const LIQUID = Platform.OS === 'ios' && (() => {
  try {
    return isLiquidGlassAvailable();
  } catch (e) {
    return false;
  }
})();

// glassScheme: GlassView colorScheme ('auto' | 'light' | 'dark') — tema tercihi 'system' değilse sabitlenir
function palette(dark, glassScheme = 'auto') {
  return dark
    ? { bg: '#0b0b13', surface: '#1a1a28', surface2: '#202032', border: '#2b2b40', text: '#eeedfb', text2: '#b1afca', text3: '#7c7a98', accent: '#8b7dff', accentSoft: '#28244a', green: '#4ade80', greenSoft: '#173222', red: '#f87171', redSoft: '#3a1a1e', dark, glassScheme }
    : { bg: '#f3f2fb', surface: '#ffffff', surface2: '#f8f7fd', border: '#e6e3f3', text: '#1c1a33', text2: '#5b5875', text3: '#908daa', accent: '#6c5cff', accentSoft: '#eeebff', green: '#16a34a', greenSoft: '#dcfce7', red: '#dc2626', redSoft: '#fee2e2', dark, glassScheme };
}

const tap = (style = Haptics.ImpactFeedbackStyle.Light) => {
  try {
    Haptics.impactAsync(style);
  } catch (e) {}
};
const success = () => {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {}
};

// Esnek (jöle) dokunma efekti
function Jelly({ children, onPress, style, scaleTo = 0.96, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        tap();
        Animated.spring(scale, { toValue: scaleTo, friction: 4, tension: 180, useNativeDriver: true }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, friction: 3, tension: 140, useNativeDriver: true }).start()}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.5 }]}>{children}</Animated.View>
    </Pressable>
  );
}

// iOS 26'da Liquid Glass, diğerlerinde klasik kart
function Glass({ c, style, children, tint, interactive }) {
  if (LIQUID) {
    return (
      <GlassView style={[s.glassBase, style]} glassEffectStyle="regular" colorScheme={c.glassScheme} tintColor={tint} isInteractive={interactive}>
        {children}
      </GlassView>
    );
  }
  return <View style={[s.glassBase, { backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }, style]}>{children}</View>;
}

function GradientButton({ title, onPress, disabled }) {
  return (
    <Jelly onPress={onPress} disabled={disabled}>
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradBtn}>
        <Text style={s.gradBtnText}>{title}</Text>
      </LinearGradient>
    </Jelly>
  );
}

function SecondaryButton({ c, title, onPress, disabled }) {
  return (
    <Jelly onPress={onPress} disabled={disabled}>
      <Glass c={c} interactive style={s.secBtn}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
      </Glass>
    </Jelly>
  );
}

function FileBadge({ name, size = 40, folder }) {
  if (folder) {
    return (
      <LinearGradient colors={['#fbbf24', '#f59e0b']} style={{ width: size, height: size, borderRadius: size * 0.27, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: size * 0.45 }}>📁</Text>
      </LinearGradient>
    );
  }
  const type = TYPE[kindOf(name)];
  return (
    <LinearGradient colors={type.colors} style={{ width: size, height: size, borderRadius: size * 0.27, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.26 }}>{type.label}</Text>
    </LinearGradient>
  );
}

// Cam efektinin görünmesi için arka planda renkli ışık küreleri
function Ambient({ c }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['#6c5cff', 'transparent']} style={[s.orb, { top: -80, left: -60, opacity: c.dark ? 0.45 : 0.28 }]} />
      <LinearGradient colors={['#ec62be', 'transparent']} style={[s.orb, { top: 260, right: -120, opacity: c.dark ? 0.35 : 0.22 }]} />
      <LinearGradient colors={['#38bdf8', 'transparent']} style={[s.orb, { bottom: -60, left: -40, opacity: c.dark ? 0.3 : 0.18 }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  // Dil/tema tercihleri ilk çizimden önce (eşzamanlı) okunur
  const [prefs, setPrefs] = useState(loadPrefs);
  const system = useColorScheme();
  const locales = useLocales();
  const dark = prefs.theme === 'system' ? system === 'dark' : prefs.theme === 'dark';
  const c = palette(dark, prefs.theme === 'system' ? 'auto' : prefs.theme);
  // Dil modül düzeyinde tutulur; alt bileşenler t() ile okur (Root her değişimde yeniden çizer)
  const language = resolveLanguage(prefs.language, locales && locales[0] ? locales[0].languageCode : undefined);
  setLanguage(language);
  const updatePrefs = (patch) => {
    const next = { ...prefs, ...patch };
    savePrefs(next);
    setPrefs(next);
  };
  const [ready, setReady] = useState(false);
  const [ghToken, setGhToken] = useState(null);
  const [ghUser, setGhUser] = useState(null);
  const [google, setGoogle] = useState(null);
  const [screen, setScreen] = useState(null); // { type: 'gh', project } | { type: 'drive', folder }
  const [accounts, setAccounts] = useState(false);

  useEffect(() => {
    Promise.all([GH.loadToken(), G.loadGoogle()]).then(([t, g]) => {
      setGhToken(t || null);
      setGoogle(g || null);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ghToken) return;
    GH.getUser(ghToken)
      .then(setGhUser)
      .catch((e) => e.auth && logoutGithub());
  }, [ghToken]);

  const drive = useMemo(() => (google ? new G.Drive(google, setGoogle) : null), [google && google.refresh_token, google && google.access_token]);

  const loginGithub = async (t) => {
    await GH.saveToken(t);
    setGhToken(t);
  };
  const logoutGithub = async () => {
    await GH.saveToken(null);
    setGhUser(null);
    setGhToken(null);
    setScreen(null);
  };
  const logoutGoogle = async () => {
    await G.saveGoogle(null);
    setGoogle(null);
    setScreen(null);
  };

  const signedIn = ghToken || google;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Ambient c={c} />
      {!ready ? (
        <View style={s.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : !signedIn ? (
        <LoginScreen c={c} onGithub={loginGithub} onGoogle={setGoogle} />
      ) : screen && screen.type === 'gh' ? (
        <ProjectScreen c={c} token={ghToken} project={screen.project} onBack={() => setScreen(null)} onAuthError={logoutGithub} />
      ) : screen && screen.type === 'drive' ? (
        <DriveScreen c={c} drive={drive} folder={screen.folder} onBack={() => setScreen(null)} onAuthError={logoutGoogle} />
      ) : (
        <HomeScreen c={c} ghToken={ghToken} ghUser={ghUser} google={google} drive={drive} onOpen={setScreen} onAccounts={() => setAccounts(true)} onAuthErrorGh={logoutGithub} onAuthErrorGoogle={logoutGoogle} />
      )}
      <SettingsSheet
        c={c}
        prefs={prefs}
        onPrefs={updatePrefs}
        visible={accounts}
        onClose={() => setAccounts(false)}
        ghUser={ghUser}
        ghToken={ghToken}
        google={google}
        onGithub={loginGithub}
        onGoogle={setGoogle}
        onLogoutGithub={logoutGithub}
        onLogoutGoogle={logoutGoogle}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Giriş
// ---------------------------------------------------------------------------
function useGithubLogin(onToken) {
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => (cancelled.current = true), []);
  const start = async () => {
    setError(null);
    setBusy(true);
    cancelled.current = false;
    try {
      const f = await GH.startDeviceFlow();
      setFlow(f);
      await Clipboard.setStringAsync(f.user_code);
      Linking.openURL(f.verification_uri);
      const t = await GH.pollToken(f, () => cancelled.current);
      success();
      setFlow(null);
      onToken(t);
    } catch (e) {
      if (!cancelled.current) setError(e.message);
      setFlow(null);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    cancelled.current = true;
    setFlow(null);
  };
  return { flow, error, busy, start, cancel };
}

function useGoogleLogin(onSession) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setError(null);
    if (!G.googleAvailable()) {
      setError(t('login.googleNotConfigured'));
      return;
    }
    setBusy(true);
    try {
      const sess = await G.signIn();
      success();
      onSession(sess);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, start };
}

function GithubCodeCard({ c, flow, onCancel }) {
  return (
    <Glass c={c} style={{ padding: 18, marginTop: 24 }}>
      <Text style={{ color: c.text2, textAlign: 'center', fontSize: 14 }}>{t('code.copied')}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, marginVertical: 16 }}>
        {flow.user_code.split('').map((ch, i) =>
          ch === '-' ? (
            <Text key={i} style={{ color: c.text3, fontSize: 24, alignSelf: 'center' }}>–</Text>
          ) : (
            <View key={i} style={[s.codeBox, { backgroundColor: c.accentSoft }]}>
              <Text style={{ color: c.accent, fontSize: 22, fontWeight: '800' }}>{ch}</Text>
            </View>
          )
        )}
      </View>
      <GradientButton
        title={t('code.copyOpen')}
        onPress={async () => {
          await Clipboard.setStringAsync(flow.user_code);
          Linking.openURL(flow.verification_uri);
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 }}>
        <ActivityIndicator color={c.accent} size="small" />
        <Text style={{ color: c.text2 }}>{t('code.waiting')}</Text>
      </View>
      <Pressable onPress={onCancel} style={{ marginTop: 10, alignSelf: 'center', padding: 8 }}>
        <Text style={{ color: c.text3 }}>{t('common.cancel')}</Text>
      </Pressable>
    </Glass>
  );
}

function LoginScreen({ c, onGithub, onGoogle }) {
  const insets = useSafeAreaInsets();
  const gh = useGithubLogin(onGithub);
  const go = useGoogleLogin(onGoogle);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(spin, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(spin, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  return (
    <View style={[s.flex, { paddingTop: insets.top + 30, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }]}>
      <View style={[s.flex, { justifyContent: 'center' }]}>
        <Animated.Text style={{ fontSize: 76, textAlign: 'center', transform: [{ rotate }] }}>⏪</Animated.Text>
        <Text style={[s.h1, { color: c.text, textAlign: 'center', marginTop: 14 }]}>DraftRewind</Text>
        <Text style={{ color: c.text2, textAlign: 'center', fontSize: 16, lineHeight: 23, marginTop: 8 }}>
          {t('login.tagline')}
        </Text>
        {gh.flow ? <GithubCodeCard c={c} flow={gh.flow} onCancel={gh.cancel} /> : null}
        {gh.error || go.error ? <Text style={{ color: c.red, textAlign: 'center', marginTop: 16 }}>😕 {gh.error || go.error}</Text> : null}
      </View>
      {!gh.flow ? (
        <View style={{ gap: 12 }}>
          <GradientButton title={gh.busy ? t('common.connecting') : t('login.github')} onPress={gh.start} disabled={gh.busy} />
          <SecondaryButton c={c} title={go.busy ? t('common.connecting') : t('login.google')} onPress={go.start} disabled={go.busy} />
          <Text style={{ color: c.text3, textAlign: 'center', fontSize: 12.5 }}>{t('login.hint')}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Seçmeli düğme grubu (dil / tema)
function Segmented({ c, options, value, onChange }) {
  return (
    <Glass c={c} style={[s.seg, { marginBottom: 0 }]}>
      {options.map(([k, label]) => (
        <Pressable
          key={k}
          onPress={() => {
            tap();
            if (k !== value) onChange(k);
          }}
          style={[s.segBtn, value === k && { backgroundColor: c.dark ? '#ffffff22' : '#ffffffcc' }]}
        >
          <Text style={{ color: value === k ? c.text : c.text2, fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>{label}</Text>
        </Pressable>
      ))}
    </Glass>
  );
}

// Ayarlar (profil resmine dokununca): hesaplar + dil + tema
function SettingsSheet({ c, prefs, onPrefs, visible, onClose, ghUser, ghToken, google, onGithub, onGoogle, onLogoutGithub, onLogoutGoogle }) {
  const gh = useGithubLogin(onGithub);
  const go = useGoogleLogin(onGoogle);
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.flex, { backgroundColor: c.bg, padding: 20 }]}>
        <View style={s.grabber} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
          <Text style={[s.h2, { color: c.text, flex: 1 }]}>{t('settings.title')}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.accent, fontWeight: '700', fontSize: 16 }}>{t('common.done')}</Text>
          </Pressable>
        </View>
        <ScrollView>
          <Text style={[s.dayHeader, { color: c.text3, marginTop: 0 }]}>{t('settings.accounts')}</Text>

          <Glass c={c} style={s.accountRow}>
            <Text style={{ fontSize: 28 }}>🐙</Text>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>GitHub</Text>
              <Text style={{ color: c.text3 }}>{ghToken ? `@${ghUser ? ghUser.login : '…'}` : t('account.notConnected')}</Text>
            </View>
            <Pressable onPress={ghToken ? onLogoutGithub : gh.start} hitSlop={10}>
              <Text style={{ color: ghToken ? c.red : c.accent, fontWeight: '700' }}>{ghToken ? t('account.logout') : gh.busy ? '…' : t('account.connect')}</Text>
            </Pressable>
          </Glass>
          {gh.flow ? <GithubCodeCard c={c} flow={gh.flow} onCancel={gh.cancel} /> : null}

          <Glass c={c} style={[s.accountRow, { marginTop: 12 }]}>
            {google && google.user && google.user.picture ? <Image source={{ uri: google.user.picture }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : <Text style={{ fontSize: 28 }}>📁</Text>}
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>Google Drive</Text>
              <Text style={{ color: c.text3 }}>{google ? google.user.email : t('account.notConnected')}</Text>
            </View>
            <Pressable onPress={google ? onLogoutGoogle : go.start} hitSlop={10}>
              <Text style={{ color: google ? c.red : c.accent, fontWeight: '700' }}>{google ? t('account.logout') : go.busy ? '…' : t('account.connect')}</Text>
            </Pressable>
          </Glass>
          {gh.error || go.error ? <Text style={{ color: c.red, marginTop: 14 }}>😕 {gh.error || go.error}</Text> : null}

          <Text style={[s.dayHeader, { color: c.text3, marginTop: 26 }]}>{t('settings.language')}</Text>
          <Segmented
            c={c}
            value={prefs.language}
            onChange={(language) => onPrefs({ language })}
            options={[
              ['auto', t('lang.auto')],
              ['tr', 'Türkçe'],
              ['en', 'English'],
            ]}
          />
          <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('settings.theme')}</Text>
          <Segmented
            c={c}
            value={prefs.theme}
            onChange={(theme) => onPrefs({ theme })}
            options={[
              ['system', t('theme.system')],
              ['light', t('theme.light')],
              ['dark', t('theme.dark')],
            ]}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ana ekran: GitHub projeleri + Drive klasörleri
// ---------------------------------------------------------------------------
function HomeScreen({ c, ghToken, ghUser, google, drive, onOpen, onAccounts, onAuthErrorGh, onAuthErrorGoogle }) {
  const insets = useSafeAreaInsets();
  const [ghList, setGhList] = useState(null);
  const [driveList, setDriveList] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [news, setNews] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const jobs = [];
    if (ghToken)
      jobs.push(
        GH.listProjects(ghToken)
          .then(async (list) => {
            setGhList(list);
            const found = await announceNewSaves(ghToken, list);
            if (found && found.length) setNews(found);
          })
          .catch((e) => {
            if (e.auth) onAuthErrorGh();
            setError(e.message);
          })
      );
    if (drive)
      jobs.push(
        drive
          .projects()
          .then(setDriveList)
          .catch((e) => {
            if (e.auth) onAuthErrorGoogle();
            setError(e.message);
          })
      );
    await Promise.all(jobs);
  }, [ghToken, drive]);

  useEffect(() => {
    load();
  }, [load]);

  // Uygulama arka plandan her öne geldiğinde yenile (yeni kayıt bildirimi için şart)
  const lastLoad = useRef(Date.now());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && Date.now() - lastLoad.current > 15000) {
        lastLoad.current = Date.now();
        load();
      }
    });
    return () => sub.remove();
  }, [load]);

  const h = new Date().getHours();
  const greet = t(h < 6 ? 'greet.night' : h < 12 ? 'greet.morning' : h < 18 ? 'greet.day' : 'greet.evening');
  const name = (ghUser && ghUser.name) || (google && google.user && google.user.name) || '';
  const avatar = (ghUser && ghUser.avatar) || (google && google.user && google.user.picture);
  const loading = (ghToken && ghList === null) || (drive && driveList === null);
  const empty = !loading && !(ghList && ghList.length) && !(driveList && driveList.length);

  return (
    <ScrollView
      style={s.flex}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 30, paddingHorizontal: 18 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.accent}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <View style={s.flex}>
          <Text style={{ color: c.text2, fontSize: 15 }}>{greet}</Text>
          <Text style={[s.h1, { color: c.text }]}>{name ? t('home.hello', { name: name.split(' ')[0] }) : t('home.myProjects')}</Text>
        </View>
        <Jelly onPress={onAccounts} scaleTo={0.9}>
          {avatar ? <Image source={{ uri: avatar }} style={s.avatar} /> : <View style={[s.avatar, { backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }]}><Text>👤</Text></View>}
        </Jelly>
      </View>

      {news ? (
        <Jelly onPress={() => setNews(null)} scaleTo={0.97} style={{ marginBottom: 14 }}>
          <Glass c={c} tint="#6c5cff44" style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 28 }}>✨</Text>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>
                {news.length === 1 ? t('home.newSavesOne', { name: news[0].name, count: news[0].count }) : t('home.newSavesMany', { n: news.length })}
              </Text>
              <Text style={{ color: c.text2, fontSize: 13, marginTop: 3 }} numberOfLines={2}>
                {news.length === 1 ? news[0].title : news.map((n) => n.name).join(', ')}
              </Text>
            </View>
            <Text style={{ color: c.text3 }}>✕</Text>
          </Glass>
        </Jelly>
      ) : null}

      <FocusCard c={c} title={t('focus.session')} />

      {error ? <Text style={{ color: c.red, marginVertical: 10 }}>😕 {error}</Text> : null}
      {loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 30 }} /> : null}

      {ghList && ghList.length ? <Text style={[s.dayHeader, { color: c.text3 }]}>{t('home.githubHeader')}</Text> : null}
      {(ghList || []).map((p, i) => (
        <Jelly key={p.repo} onPress={() => onOpen({ type: 'gh', project: p })} scaleTo={0.97} style={{ marginBottom: 10 }}>
          <Glass c={c} interactive style={s.projRow}>
            <LinearGradient colors={i % 2 ? ['#ec62be', '#a35cf6'] : GRAD} style={s.projTile}>
              <Text style={{ fontSize: 24 }}>{['📘', '🎓', '🧪', '📗', '🔭', '📙'][i % 6]}</Text>
            </LinearGradient>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{p.name}</Text>
              <Text style={{ color: c.text3, fontSize: 13, marginTop: 2 }}>{t('home.lastBackup', { ago: ago(p.pushedAt) })}</Text>
            </View>
            <Text style={{ color: c.text3, fontSize: 22 }}>›</Text>
          </Glass>
        </Jelly>
      ))}

      {driveList && driveList.length ? <Text style={[s.dayHeader, { color: c.text3 }]}>📁 GOOGLE DRIVE</Text> : null}
      {(driveList || []).map((f) => (
        <Jelly key={f.id} onPress={() => onOpen({ type: 'drive', folder: f })} scaleTo={0.97} style={{ marginBottom: 10 }}>
          <Glass c={c} interactive style={s.projRow}>
            <LinearGradient colors={['#fbbf24', '#f97316']} style={s.projTile}>
              <Text style={{ fontSize: 24 }}>📁</Text>
            </LinearGradient>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{f.name}</Text>
              <Text style={{ color: c.text3, fontSize: 13, marginTop: 2 }}>{t('home.updated', { ago: ago(f.modified) })}</Text>
            </View>
            <Text style={{ color: c.text3, fontSize: 22 }}>›</Text>
          </Glass>
        </Jelly>
      ))}

      {empty ? (
        <Glass c={c} style={{ alignItems: 'center', paddingVertical: 30, paddingHorizontal: 18, marginTop: 10 }}>
          <Text style={{ fontSize: 48 }}>🌱</Text>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700', marginTop: 8 }}>{t('home.emptyTitle')}</Text>
          <Text style={{ color: c.text2, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>
            {t('home.emptyBody')}
          </Text>
        </Glass>
      ) : null}
    </ScrollView>
  );
}

// Telefonda en son bakıldığından beri bilgisayarda yeni kayıt olduysa Dinamik Ada'da kısaca göster
async function announceNewSaves(token, list) {
  const seen = loadSeen();
  const firstRun = Object.keys(seen).length === 0;
  const news = [];
  for (const p of list) {
    const key = `${p.owner}/${p.repo}`;
    const last = seen[key] || 0;
    if (!firstRun && p.pushedAt > last) {
      try {
        const snaps = (await GH.listSnapshots(token, p, 1)).filter((s) => s.time > last && s.kind !== 'merge');
        if (snaps.length) {
          const words = snaps.reduce((a, s) => a + Object.values(s.delta || {}).reduce((x, y) => x + y, 0), 0);
          news.push({ name: p.name, count: snaps.length, words, title: snaps[0].title });
        }
      } catch (e) {}
    }
    seen[key] = Math.max(last, p.pushedAt);
  }
  saveSeen(seen);
  if (!news.length) return news;
  const total = news.reduce((a, n) => a + n.count, 0);
  const words = news.reduce((a, n) => a + n.words, 0);
  success();
  pulse(
    {
      icon: 'sparkles',
      color: '#a99dff',
      title: news.length === 1 ? t('pulse.titleOne', { name: news[0].name, count: total }) : t('pulse.titleMany', { n: news.length, count: total }),
      subtitle: news.length === 1 ? news[0].title : t('pulse.synced'),
      short: words > 0 ? `+${num(words)}` : t('pulse.newShort', { count: total }),
    },
    7000
  );
  return news;
}

// ---------------------------------------------------------------------------
// Odak modu (Dinamik Ada)
// ---------------------------------------------------------------------------
let focusInstance = null;
let focusEndAt = null;

function FocusCard({ c, title }) {
  const [endAt, setEndAt] = useState(focusEndAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!endAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener('change', () => setNow(Date.now()));
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [endAt]);

  useEffect(() => {
    if (endAt && now >= endAt) {
      success();
      stop(true);
    }
  }, [now, endAt]);

  const start = (minutes) => {
    const startAt = Date.now();
    const end = startAt + minutes * 60 * 1000;
    try {
      if (FocusActivity) focusInstance = FocusActivity.start({ title, startAt, endAt: end, caption: t('focus.activityCaption'), label: t('focus.activityLabel') });
    } catch (e) {}
    focusEndAt = end;
    setEndAt(end);
    setNow(Date.now());
    tap(Haptics.ImpactFeedbackStyle.Medium);
  };

  const stop = (finished) => {
    try {
      if (focusInstance) focusInstance.end('immediate');
    } catch (e) {}
    focusInstance = null;
    focusEndAt = null;
    setEndAt(null);
    if (!finished) tap();
  };

  const left = endAt ? Math.max(0, Math.round((endAt - now) / 1000)) : 0;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <Glass c={c} tint={endAt ? '#6c5cff33' : undefined} style={{ padding: 16, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 30 }}>{endAt ? '✍️' : '⏱️'}</Text>
        <View style={s.flex}>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{endAt ? t('focus.active') : t('focus.title')}</Text>
          <Text style={{ color: c.text2, fontSize: 13, marginTop: 2 }}>
            {endAt ? t('focus.activeSub') : t('focus.idleSub')}
          </Text>
        </View>
        {endAt ? <Text style={{ color: c.accent, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{mm}:{ss}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        {endAt ? (
          <Jelly onPress={() => stop(false)} style={s.flex}>
            <View style={[s.chipBtn, { backgroundColor: c.redSoft }]}>
              <Text style={{ color: c.red, fontWeight: '700' }}>{t('focus.end')}</Text>
            </View>
          </Jelly>
        ) : (
          [15, 25, 45].map((m) => (
            <Jelly key={m} onPress={() => start(m)} style={s.flex}>
              <View style={[s.chipBtn, { backgroundColor: c.accentSoft }]}>
                <Text style={{ color: c.accent, fontWeight: '800' }}>{t('focus.minutes', { n: m })}</Text>
              </View>
            </Jelly>
          ))
        )}
      </View>
    </Glass>
  );
}

// ---------------------------------------------------------------------------
// GitHub proje ayrıntısı
// ---------------------------------------------------------------------------
function ProjectScreen({ c, token, project, onBack, onAuthError }) {
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState(null);
  const [files, setFiles] = useState(null);
  const [tab, setTab] = useState('time');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [viewer, setViewer] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [h, f] = await Promise.all([GH.listSnapshots(token, project), GH.listFiles(token, project)]);
      setHistory(h);
      setFiles(f);
    } catch (e) {
      if (e.auth) onAuthError();
      setError(e.message);
    }
  }, [token, project]);

  useEffect(() => {
    load();
  }, [load]);

  const sizeOf = (path) => ((files || []).find((f) => f.path === path) || {}).size || 0;
  const openFile = (path, ref) =>
    setViewer({ name: path.split('/').pop(), subtitle: ref ? t('project.oldVersion') : t('project.current'), size: sizeOf(path), load: () => GH.fileContent(token, project, path, ref) });
  const openDiff = (path, ref, parentRef) =>
    setViewer({
      name: path.split('/').pop(),
      subtitle: t('project.whatChanged'),
      diff: {
        loadOld: () => (parentRef ? GH.fileContent(token, project, path, parentRef).catch(() => null) : Promise.resolve(null)),
        loadNew: () => GH.fileContent(token, project, path, ref),
      },
    });

  const language = lang();
  const stats = useMemo(() => (history ? computeStats(history) : null), [history, language]);
  const words = history && history[0] && history[0].words ? history[0].words : {};
  const sortedFiles = useMemo(
    () => (files ? [...files].sort((a, b) => (kindOf(a.path) === 'word' ? -1 : 0) - (kindOf(b.path) === 'word' ? -1 : 0) || a.path.localeCompare(b.path, language)) : []),
    [files, language]
  );
  const maxWeek = stats ? Math.max(1, ...stats.week.map((w) => w.words)) : 1;

  let lastDay = '';
  return (
    <View style={s.flex}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 30, paddingHorizontal: 18 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.accent}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Pressable onPress={onBack} style={{ paddingVertical: 8, alignSelf: 'flex-start' }} hitSlop={12}>
          <Text style={{ color: c.accent, fontSize: 17, fontWeight: '600' }}>‹ {t('nav.projects')}</Text>
        </Pressable>
        <Text style={[s.h1, { color: c.text, marginBottom: 14 }]} numberOfLines={2}>{project.name}</Text>

        {error ? <Text style={{ color: c.red, marginBottom: 12 }}>😕 {error}</Text> : null}
        {!stats && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} /> : null}

        {stats ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StatCard c={c} emoji="🔥" label={t('stats.streak')} value={t('stats.days', { n: stats.streak, count: stats.streak })} hot />
              <StatCard c={c} emoji="✍️" label={t('stats.today')} value={`+${num(Math.max(0, stats.today))}`} />
              <StatCard c={c} emoji="📚" label={t('stats.words')} value={num(stats.total)} />
            </View>

            <Glass c={c} style={{ padding: 16, marginTop: 10 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{t('stats.thisWeek')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 8, marginTop: 12 }}>
                {stats.week.map((w, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    {i === 6 ? (
                      <LinearGradient colors={GRAD} style={[s.bar, { height: `${Math.max(6, (w.words / maxWeek) * 80)}%` }]} />
                    ) : (
                      <View style={[s.bar, { height: `${Math.max(6, (w.words / maxWeek) * 80)}%`, backgroundColor: w.words ? c.accent + '66' : c.border }]} />
                    )}
                    <Text style={{ color: c.text3, fontSize: 10.5, marginTop: 5, fontWeight: '600' }}>{w.label}</Text>
                  </View>
                ))}
              </View>
            </Glass>

            <View style={{ marginTop: 12 }}>
              <FocusCard c={c} title={project.name} />
            </View>

            <Glass c={c} style={[s.seg, { marginTop: 4 }]}>
              {[
                ['time', t('tab.time', { n: num(history.length) })],
                ['docs', t('tab.docs', { n: num(files.length) })],
              ].map(([k, label]) => (
                <Pressable
                  key={k}
                  onPress={() => {
                    tap();
                    setTab(k);
                  }}
                  style={[s.segBtn, tab === k && { backgroundColor: c.dark ? '#ffffff22' : '#ffffffcc' }]}
                >
                  <Text style={{ color: tab === k ? c.text : c.text2, fontWeight: '700', fontSize: 13.5 }}>{label}</Text>
                </Pressable>
              ))}
            </Glass>

            {tab === 'time'
              ? history.map((h) => {
                  const d = dayLabel(h.time);
                  const header = d !== lastDay ? d : null;
                  lastDay = d;
                  const w = Object.values(h.delta || {}).reduce((a, b) => a + b, 0);
                  return (
                    <View key={h.oid}>
                      {header ? <Text style={[s.dayHeader, { color: c.text3 }]}>{header.toUpperCase()}</Text> : null}
                      <Jelly onPress={() => setSnapshot(h)} scaleTo={0.98} style={{ marginBottom: 8 }}>
                        <Glass c={c} interactive tint={h.kind === 'star' ? '#ffb93833' : undefined} style={s.tlItem}>
                          <View style={[s.node, { backgroundColor: h.kind === 'star' ? '#ffb938' : c.accentSoft }]}>
                            <Text style={{ fontSize: 15 }}>{KIND_ICON[h.kind] || '💾'}</Text>
                          </View>
                          <View style={s.flex}>
                            <Text style={{ color: c.text, fontWeight: '600', fontSize: 14.5, lineHeight: 19 }} numberOfLines={2}>{h.title}</Text>
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center' }}>
                              <Text style={{ color: c.text3, fontSize: 12 }}>{hm(h.time)}</Text>
                              {w ? (
                                <View style={[s.chip, { backgroundColor: w > 0 ? c.greenSoft : c.redSoft }]}>
                                  <Text style={{ color: w > 0 ? c.green : c.red, fontSize: 11, fontWeight: '800' }}>{w > 0 ? '+' : ''}{num(w)}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        </Glass>
                      </Jelly>
                    </View>
                  );
                })
              : sortedFiles.map((f) => (
                  <Jelly key={f.path} onPress={() => openFile(f.path, null)} scaleTo={0.98} style={{ marginTop: 8 }}>
                    <Glass c={c} interactive style={s.tlItem}>
                      <FileBadge name={f.path} />
                      <View style={s.flex}>
                        <Text style={{ color: c.text, fontWeight: '600', fontSize: 14.5 }} numberOfLines={1}>{f.path.split('/').pop()}</Text>
                        <Text style={{ color: c.text3, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                          {f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) + ' · ' : ''}
                          {words[f.path] != null ? t('words.count', { n: num(words[f.path]), count: words[f.path] }) : `${Math.max(1, Math.round(f.size / 1024))} KB`}
                        </Text>
                      </View>
                      <Text style={{ color: c.text3, fontSize: 20 }}>›</Text>
                    </Glass>
                  </Jelly>
                ))}
          </>
        ) : null}
      </ScrollView>

      <SnapshotSheet
        c={c}
        token={token}
        project={project}
        snapshot={snapshot}
        onClose={() => setSnapshot(null)}
        onOpenFile={openFile}
        onOpenDiff={openDiff}
        viewer={viewer}
        onCloseViewer={() => setViewer(null)}
      />
      {/* iOS'ta açık bir sayfanın üstüne ikinci sayfa açılamaz: kayıt ayrıntısı açıkken görüntüleyici onun içinde */}
      {!snapshot ? <ViewerSheet c={c} target={viewer} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

function StatCard({ c, emoji, label, value, hot }) {
  return (
    <Glass c={c} style={[s.flex, { padding: 14 }]}>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
      <Text style={{ color: c.text3, fontSize: 12, fontWeight: '600', marginTop: 6 }}>{label}</Text>
      <Text style={{ color: hot ? '#ff7a45' : c.text, fontSize: 20, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </Glass>
  );
}

function SnapshotSheet({ c, token, project, snapshot, onClose, onOpenFile, onOpenDiff, viewer, onCloseViewer }) {
  const [files, setFiles] = useState(null);
  const [parent, setParent] = useState(null);
  useEffect(() => {
    if (!snapshot) return;
    setFiles(null);
    GH.commitFiles(token, project, snapshot.oid)
      .then((r) => {
        setFiles(r.files);
        setParent(r.parent);
      })
      .catch(() => setFiles([]));
  }, [snapshot]);
  if (!snapshot) return null;
  const d = new Date(snapshot.time);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.flex, { backgroundColor: c.bg, padding: 20 }]}>
        <View style={s.grabber} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Text style={{ fontSize: 34 }}>{KIND_ICON[snapshot.kind] || '💾'}</Text>
          <View style={s.flex}>
            <Text style={{ color: c.text, fontSize: 19, fontWeight: '800' }}>{snapshot.title}</Text>
            <Text style={{ color: c.text3, marginTop: 4 }}>
              {d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })} · {hm(snapshot.time)}
            </Text>
            {snapshot.note ? <Text style={{ color: c.text2, marginTop: 8 }}>{snapshot.note}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.accent, fontWeight: '700', fontSize: 16 }}>{t('common.close')}</Text>
          </Pressable>
        </View>

        <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('snapshot.changed')}</Text>
        {files === null ? <ActivityIndicator color={c.accent} style={{ marginTop: 20 }} /> : null}
        <ScrollView>
          {(files || []).map((f) => {
            const delta = snapshot.delta[f.path];
            const removed = f.status === 'removed';
            const kind = kindOf(f.path);
            const canDiff = !removed && (kind === 'word' || kind === 'text');
            return (
              <Glass key={f.path} c={c} style={[s.tlItem, { marginBottom: 12, flexWrap: 'wrap', padding: 16 }]}>
                <FileBadge name={f.path} size={40} />
                <View style={s.flex}>
                  <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{f.path.split('/').pop()}</Text>
                  <Text style={{ color: c.text3, fontSize: 12, marginTop: 2 }}>
                    {removed ? t('snapshot.removed') : f.status === 'added' ? t('snapshot.added') : t('snapshot.modified')}
                    {delta ? ` · ${t('words.count', { n: (delta > 0 ? '+' : '') + num(delta), count: Math.abs(delta) })}` : ''}
                  </Text>
                </View>
                {!removed ? (
                  <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 14 }}>
                    {canDiff ? (
                      <Jelly style={s.flex} onPress={() => onOpenDiff(f.path, snapshot.oid, f.status === 'added' ? null : parent)}>
                        <View style={[s.actionBtn, { backgroundColor: c.greenSoft }]}>
                          <Text style={{ color: c.green, fontWeight: '800', fontSize: 15 }}>{t('snapshot.diff')}</Text>
                        </View>
                      </Jelly>
                    ) : null}
                    <Jelly style={s.flex} onPress={() => onOpenFile(f.path, snapshot.oid)}>
                      <View style={[s.actionBtn, { backgroundColor: c.accentSoft }]}>
                        <Text style={{ color: c.accent, fontWeight: '800', fontSize: 15 }}>{t('snapshot.thisVersion')}</Text>
                      </View>
                    </Jelly>
                  </View>
                ) : null}
              </Glass>
            );
          })}
          {files && files.length === 0 ? <Text style={{ color: c.text2, marginTop: 10 }}>{t('snapshot.noFiles')}</Text> : null}
        </ScrollView>
      </View>
      <ViewerSheet c={c} target={viewer} onClose={onCloseViewer} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Drive klasörü
// ---------------------------------------------------------------------------
function DriveScreen({ c, drive, folder, onBack, onAuthError }) {
  const insets = useSafeAreaInsets();
  const [stack, setStack] = useState([folder]);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [viewer, setViewer] = useState(null);
  const current = stack[stack.length - 1];

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      setItems(await drive.children(current.id));
    } catch (e) {
      if (e.auth) onAuthError();
      setError(e.message);
    }
  }, [current.id]);

  useEffect(() => {
    load();
  }, [load]);

  const back = () => (stack.length > 1 ? setStack(stack.slice(0, -1)) : onBack());
  const isVersions = current.name === '_Sürümler';

  return (
    <View style={s.flex}>
      <ScrollView style={s.flex} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 30, paddingHorizontal: 18 }}>
        <Pressable onPress={back} style={{ paddingVertical: 8, alignSelf: 'flex-start' }} hitSlop={12}>
          <Text style={{ color: c.accent, fontSize: 17, fontWeight: '600' }}>‹ {stack.length > 1 ? stack[stack.length - 2].name : t('nav.projects')}</Text>
        </Pressable>
        <Text style={[s.h1, { color: c.text, marginBottom: 4 }]} numberOfLines={2}>{isVersions ? t('drive.versions') : current.name}</Text>
        <Text style={{ color: c.text3, marginBottom: 14 }}>{isVersions ? t('drive.versionsSub') : 'Google Drive'}</Text>
        {stack.length === 1 ? <FocusCard c={c} title={folder.name} /> : null}
        {error ? <Text style={{ color: c.red }}>😕 {error}</Text> : null}
        {items === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: 30 }} /> : null}
        {(isVersions ? [...(items || [])].sort((a, b) => (a.folder === b.folder ? b.name.localeCompare(a.name) : a.folder ? -1 : 1)) : items || []).map((it) => (
          <Jelly
            key={it.id}
            scaleTo={0.98}
            style={{ marginBottom: 8 }}
            onPress={() =>
              it.folder
                ? setStack([...stack, it])
                : setViewer({ name: it.name, subtitle: `Drive · ${ago(it.modified)}`, size: it.size, load: () => drive.download(it.id) })
            }
          >
            <Glass c={c} interactive style={s.tlItem}>
              <FileBadge name={it.name} folder={it.folder} />
              <View style={s.flex}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14.5 }} numberOfLines={2}>{it.name === '_Sürümler' ? t('drive.versionsFolder') : it.name}</Text>
                <Text style={{ color: c.text3, fontSize: 12, marginTop: 2 }}>
                  {it.folder ? t('drive.folder') : `${Math.max(1, Math.round(it.size / 1024))} KB`} · {ago(it.modified)}
                </Text>
              </View>
              <Text style={{ color: c.text3, fontSize: 20 }}>›</Text>
            </Glass>
          </Jelly>
        ))}
        {items && items.length === 0 ? <Text style={{ color: c.text2 }}>{t('drive.empty')}</Text> : null}
      </ScrollView>
      <ViewerSheet c={c} target={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Belge görüntüleyici (GitHub ve Drive ortak)
// ---------------------------------------------------------------------------
function ViewerSheet({ c, target, onClose }) {
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!target) return;
    setSource(null);
    setError(null);
    setReady(false);
    let alive = true;
    (async () => {
      try {
        if (target.diff) {
          const [oldBuf, newBuf] = await Promise.all([target.diff.loadOld(), target.diff.loadNew()]);
          if (!alive) return;
          setSource({ html: diffHtml(oldBuf ? arrayBufferToBase64(oldBuf) : null, arrayBufferToBase64(newBuf), kindOf(target.name), c.dark, viewerLabels()) });
          return;
        }
        // Büyük dosyalarda indirme durumu Dinamik Ada'da (uygulamadan çıksan da görünür)
        const big = (target.size || 0) > 700 * 1024;
        const island = big ? pulse({ icon: 'arrow.down.circle', color: '#38bdf8', title: target.name, subtitle: t('pulse.downloading'), short: t('pulse.downloadingShort') }, 60000) : null;
        let buf;
        try {
          buf = await target.load();
        } catch (e) {
          if (island) island.finish({ icon: 'exclamationmark.triangle', color: '#f87171', subtitle: t('pulse.failed'), short: t('pulse.failedShort') });
          throw e;
        }
        if (island) island.finish({ icon: 'checkmark.circle.fill', color: '#4ade80', subtitle: t('pulse.ready'), short: t('pulse.readyShort') });
        if (!alive) return;
        const kind = kindOf(target.name);
        const b64 = arrayBufferToBase64(buf);
        if (kind === 'word') setSource({ html: wordHtml(b64, c.dark, viewerLabels()) });
        else if (kind === 'sheet') setSource({ html: sheetHtml(b64, c.dark, viewerLabels()) });
        else if (kind === 'pdf') setSource({ uri: `data:application/pdf;base64,${b64}` });
        else if (kind === 'image') setSource({ image: `data:image/${target.name.split('.').pop().toLowerCase()};base64,${b64}` });
        else if (kind === 'text') setSource({ html: textHtml(utf8Decode(buf), c.dark, viewerLabels()) });
        else setError(t('viewer.unsupported'));
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  if (!target) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.flex, { backgroundColor: c.bg }]}>
        <View style={[s.viewerHead, { borderColor: c.border }]}>
          <View style={s.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <FileBadge name={target.name} size={34} />
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>{target.name}</Text>
              <Text style={{ color: c.text3, fontSize: 12 }}>{target.subtitle}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: c.accent, fontWeight: '700', fontSize: 16 }}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
        {error ? (
          <View style={s.center}>
            <Text style={{ fontSize: 40 }}>😕</Text>
            <Text style={{ color: c.text2, marginTop: 8, textAlign: 'center', paddingHorizontal: 30 }}>{error}</Text>
          </View>
        ) : source && source.image ? (
          <ScrollView contentContainerStyle={{ padding: 16 }} maximumZoomScale={4}>
            <Image source={{ uri: source.image }} style={{ width: '100%', aspectRatio: 1, borderRadius: 12 }} resizeMode="contain" />
          </ScrollView>
        ) : source ? (
          <View style={s.flex}>
            <WebView
              source={source.html ? { html: source.html, baseUrl: 'https://draftrewind.local/' } : { uri: source.uri }}
              originWhitelist={['*']}
              style={{ flex: 1, backgroundColor: c.bg }}
              onMessage={() => setReady(true)}
              onLoadEnd={() => source.uri && setReady(true)}
            />
            {!ready ? (
              <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: c.bg }]}>
                <ActivityIndicator color={c.accent} size="large" />
                <Text style={{ color: c.text2, marginTop: 12 }}>{t('viewer.preparing')}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={s.center}>
            <ActivityIndicator color={c.accent} size="large" />
            <Text style={{ color: c.text2, marginTop: 12 }}>{t('viewer.downloading')}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  h2: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  glassBase: { borderRadius: 22, overflow: 'hidden' },
  orb: { position: 'absolute', width: 380, height: 380, borderRadius: 190 },
  gradBtn: { height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  gradBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secBtn: { height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  codeBox: { width: 34, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  projRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  projTile: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  bar: { width: '100%', maxWidth: 30, borderRadius: 8 },
  seg: { flexDirection: 'row', padding: 4, marginBottom: 6, borderRadius: 16 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  chipBtn: { height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionBtn: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  dayHeader: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  tlItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 },
  node: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 999 },
  grabber: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#8886', alignSelf: 'center', marginBottom: 12 },
  viewerHead: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
