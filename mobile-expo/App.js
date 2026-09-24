import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { WebView } from 'react-native-webview';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useLocales } from 'expo-localization';
import { Directory, File, Paths } from 'expo-file-system';

import * as GH from './src/github';
import * as G from './src/google';
import { computeStats, deepStats, latestWords, ago, dayLabel, hm, num, kindOf } from './src/stats';
import { arrayBufferToBase64, wordHtml, sheetHtml, textHtml, utf8Decode, diffHtml } from './src/viewer';
import { loadViewerLibs, LIBS_FOR } from './src/viewerLibs';
import { pulse, isIslandUsable, setIslandEnabled, loadSeen, saveSeen, loadPendingNews, savePendingNews } from './src/island';
import { MAX_UPLOAD, PHONE_FOLDER, fileType, safeName, uniqueName, shareBuffer, pickFiles, takePhotos, pickPhotos, readBytes, readBase64, discardPicked, mb } from './src/files';
import { isPairLink, decodePairLink } from './src/pair';
import { t, lang, locale, resolveLanguage, setLanguage, loadPrefs, savePrefs, viewerLabels } from './src/i18n';
import { ensurePermission, checkBackupHealth, dismissBackupCard } from './src/notify';
import { reportHtml, htmlToPdf, reportFileName, REPORT_MAX_FILES, REPORT_MAX_BLOCKS } from './src/report';
import { Icon } from './src/Icon';
import { useAiStatus, shouldShowAiHint, dismissAiHint, aiHintText, aiErrorText, summarizeDocument, summarizeChanges, weekRecap } from './src/ai';

const GRAD = ['#6c5cff', '#a35cf6', '#ec62be'];
// Kayıt türü → SF Symbol adı
const KIND_ICON = { auto: 'clock.arrow.circlepath', star: 'star.fill', rescue: 'bolt.fill', restore: 'arrow.uturn.backward', merge: 'arrow.triangle.merge', mobile: 'iphone' };
const kindIcon = (k) => KIND_ICON[k] || KIND_ICON.auto;
// Proje kutucukları için dönüşümlü ikonlar
const PROJECT_ICONS = ['book.closed.fill', 'graduationcap.fill', 'flask.fill', 'books.vertical.fill', 'pencil.and.outline', 'text.book.closed.fill'];
// Projenin sıra numarasına göre karo rengi ve ikonu (ana ekran listesi ile proje başlığı aynı görünür)
const projectLook = (i = 0) => ({ colors: i % 2 ? ['#ec62be', '#a35cf6'] : GRAD, icon: PROJECT_ICONS[i % PROJECT_ICONS.length] });
const DRIVE_LOOK = { colors: ['#fbbf24', '#f97316'], icon: 'folder.fill' };
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
const warn = () => {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {}
};

// Esnek (jöle) dokunma efekti. onLongPress: basılı tutunca (dokunsal geri bildirimle) — ör. belge eylemleri
function Jelly({ children, onPress, onLongPress, style, scaleTo = 0.96, disabled, accessibilityLabel, testID }) {
  const scale = useRef(new Animated.Value(1)).current;
  // flex, dış Pressable'a da uygulanır; yoksa satırdaki kartlar içeriğe göre daralır
  const flat = StyleSheet.flatten(style) || {};
  const outer = flat.flex != null ? { flex: flat.flex } : null;
  return (
    <Pressable
      style={outer}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPressIn={() => {
        tap();
        Animated.spring(scale, { toValue: scaleTo, friction: 4, tension: 180, useNativeDriver: true }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, friction: 3, tension: 140, useNativeDriver: true }).start()}
      onPress={onPress}
      delayLongPress={380}
      onLongPress={
        onLongPress
          ? () => {
              tap(Haptics.ImpactFeedbackStyle.Medium);
              Animated.sequence([
                Animated.spring(scale, { toValue: scaleTo - 0.03, friction: 5, tension: 220, useNativeDriver: true }),
                Animated.spring(scale, { toValue: 1, friction: 3, tension: 140, useNativeDriver: true }),
              ]).start();
              onLongPress();
            }
          : undefined
      }
    >
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.5 }]}>{children}</Animated.View>
    </Pressable>
  );
}

// iOS eylem sayfası (Android'de basit uyarı penceresi). actions: [{ label, onPress, destructive }]
function showActions(c, { title, message, actions }) {
  const list = actions.filter(Boolean);
  if (Platform.OS === 'ios') {
    const destructive = list.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [...list.map((a) => a.label), t('common.cancel')],
        cancelButtonIndex: list.length,
        destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
        userInterfaceStyle: c.dark ? 'dark' : 'light',
      },
      (i) => {
        if (i < list.length) list[i].onPress();
      }
    );
  } else {
    Alert.alert(title, message, [...list.map((a) => ({ text: a.label, onPress: a.onPress })), { text: t('common.cancel'), style: 'cancel' }]);
  }
}

// Belgeyi indir → önbelleğe gerçek adıyla yaz → paylaşım sayfası (WhatsApp, Mail, AirDrop, Dosyalar…)
async function shareDoc(setBusy, name, load) {
  setBusy(t('doc.preparingShare'));
  try {
    const buf = await load();
    setBusy(null);
    await shareBuffer(name, buf);
  } catch (e) {
    setBusy(null);
    warn();
    Alert.alert(t('doc.shareFailed'), e && e.message ? e.message : String(e));
  }
}

// Eski sürüm paylaşılırken dosya adına tarih eklenir: "Tez (24 Eyl 14.05).docx"
function versionName(name, time) {
  if (!time) return name;
  const d = new Date(time);
  const stamp = `${t('day.date', { d: d.getDate(), month: t('months')[d.getMonth()] })} ${hm(time).replace(':', '.')}`;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${stamp})${name.slice(dot)}` : `${name} (${stamp})`;
}

const shortDate = (time) => {
  const d = new Date(time);
  return t('day.date', { d: d.getDate(), month: t('months')[d.getMonth()] });
};

// Yarı saydam "hazırlanıyor" göstergesi
function BusyHud({ c, text }) {
  if (!text) return null;
  return (
    <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: c.dark ? '#0006' : '#0000001a' }]}>
      <Glass c={c} style={{ paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', gap: 12, borderRadius: 22, maxWidth: 260 }}>
        <ActivityIndicator color={c.accent} size="large" />
        <Text style={{ color: c.text, fontWeight: '600', textAlign: 'center' }}>{text}</Text>
      </Glass>
    </View>
  );
}

// Başlıktaki yuvarlak "+" düğmesi (telefondan dosya ekle).
// onPress tek bir işlemse doğrudan çalışır; options verilirse iOS eylem sayfası açılır (Vazgeç ile kapanır).
function AddButton({ c, onPress, options, busy }) {
  const open = () => {
    if (options && options.length) showActions(c, { title: t('upload.menuTitle'), actions: options });
    else if (onPress) onPress();
  };
  return (
    <Jelly onPress={open} disabled={busy} scaleTo={0.88} accessibilityLabel={t('upload.add')} testID="add-button">
      <Glass c={c} interactive tint={c.accent + '33'} style={s.roundBtn}>
        {busy ? <ActivityIndicator color={c.accent} size="small" /> : <Text style={{ color: c.accent, fontSize: 26, fontWeight: '500', marginTop: -2 }}>+</Text>}
      </Glass>
    </Jelly>
  );
}

// Gizli WebView: diffHtml'i rapor modunda çalıştırır ve çizilen HTML'i uygulamaya geri verir.
// Sırayla tek iş: render(html) → Promise<{ html, add, rem, first, unchanged, truncated } | { failed }>
function useDiffWorker() {
  const [job, setJob] = useState(null); // { html, key }
  const waiter = useRef(null);
  const render = (html) =>
    new Promise((resolve) => {
      const key = Date.now() + Math.random();
      const timer = setTimeout(() => finish({ failed: true, error: 'timeout' }), 45000);
      const finish = (r) => {
        clearTimeout(timer);
        if (waiter.current && waiter.current.key === key) waiter.current = null;
        setJob(null);
        resolve(r);
      };
      waiter.current = { key, finish };
      setJob({ html, key });
    });
  const onMessage = (e) => {
    const data = e && e.nativeEvent ? e.nativeEvent.data : '';
    if (typeof data !== 'string' || data[0] !== '{') return;
    let m = null;
    try {
      m = JSON.parse(data);
    } catch (err) {}
    if (m && m.type === 'rendered' && waiter.current) waiter.current.finish(m);
  };
  const element = job ? (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 }} pointerEvents="none">
      <WebView key={job.key} source={{ html: job.html, baseUrl: 'https://draftrewind.local/' }} originWhitelist={['*']} onMessage={onMessage} onError={() => waiter.current && waiter.current.finish({ failed: true })} />
    </View>
  ) : null;
  return { render, element };
}

// Ekran başlığı: geri düğmesi + "hangi projedeyim" bloğu (renkli karo, büyük ad, alt satır).
// Bağlantı gibi değil, belirgin bir kart gibi görünür; açık/koyu temada tema renklerini kullanır.
function ScreenHeader({ c, onBack, backLabel, right, look, eyebrow, title, subtitle }) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Jelly onPress={onBack} scaleTo={0.92} accessibilityLabel={backLabel} testID="back-button">
          <Glass c={c} interactive style={[s.pillBtn, s.btnRow, s.backPill]}>
            <Icon name="chevron.left" size={13} color={c.accent} weight="semibold" />
            <Text style={{ color: c.accent, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{backLabel}</Text>
          </Glass>
        </Jelly>
        <View style={s.flex} />
        {right || null}
      </View>
      <Glass c={c} style={s.headBlock}>
        <LinearGradient colors={look.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.headTile}>
          <Icon name={look.icon} size={28} color="#fff" />
        </LinearGradient>
        <View style={s.flex}>
          <Text style={{ color: c.text3, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }} numberOfLines={1}>{eyebrow}</Text>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 }} numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={{ color: c.text2, fontSize: 13, marginTop: 3 }} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </Glass>
    </>
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

function GradientButton({ title, onPress, disabled, icon }) {
  return (
    <Jelly onPress={onPress} disabled={disabled}>
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.gradBtn, icon && s.btnRow]}>
        {icon ? <Icon name={icon} size={18} color="#fff" weight="semibold" /> : null}
        <Text style={s.gradBtnText}>{title}</Text>
      </LinearGradient>
    </Jelly>
  );
}

function SecondaryButton({ c, title, onPress, disabled, icon }) {
  return (
    <Jelly onPress={onPress} disabled={disabled}>
      <Glass c={c} interactive style={[s.secBtn, icon && s.btnRow]}>
        {icon ? <Icon name={icon} size={18} color={c.text} weight="semibold" /> : null}
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
      </Glass>
    </Jelly>
  );
}

function FileBadge({ name, size = 40, folder }) {
  if (folder) {
    return (
      <LinearGradient colors={['#fbbf24', '#f59e0b']} style={{ width: size, height: size, borderRadius: size * 0.27, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="folder.fill" size={size * 0.48} color="#fff" />
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
// İskelet (yükleniyor) yer tutucuları: üzerinde yavaşça kayan bir ışık
// ---------------------------------------------------------------------------
function Shimmer({ c, style, children }) {
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1250, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-w, w] });
  return (
    <View style={[{ overflow: 'hidden' }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {children}
      {w ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
          <LinearGradient colors={['transparent', c.dark ? '#ffffff16' : '#ffffffaa', 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function Bone({ c, w = '100%', h = 12, r = 6, style }) {
  return <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: c.dark ? '#ffffff14' : '#1c1a3312' }, style]} />;
}

// variant: 'project' (büyük kutucuklu satır) | 'row' (zaman çizelgesi / dosya satırı)
function SkeletonRows({ c, rows = 3, variant = 'row', style }) {
  const big = variant === 'project';
  return (
    <View style={style} accessibilityLabel="…" accessible>
      {Array.from({ length: rows }).map((_, i) => (
        <Glass key={i} c={c} style={[big ? s.projRow : s.tlItem, { marginBottom: big ? 10 : 8 }]}>
          <Shimmer c={c} style={{ flexDirection: 'row', alignItems: 'center', gap: big ? 14 : 12, flex: 1 }}>
            <Bone c={c} w={big ? 52 : 34} h={big ? 52 : 34} r={big ? 16 : 17} />
            <View style={[s.flex, { gap: 7 }]}>
              <Bone c={c} w={`${[72, 58, 66, 50][i % 4]}%`} h={big ? 15 : 13} />
              <Bone c={c} w={`${[38, 46, 30, 42][i % 4]}%`} h={10} />
            </View>
          </Shimmer>
        </Glass>
      ))}
    </View>
  );
}

// Proje ekranı açılırken: istatistik kartları + hafta grafiği + birkaç satır
function ProjectSkeleton({ c }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <Glass key={i} c={c} style={[s.flex, { padding: 14 }]}>
            <Shimmer c={c} style={{ gap: 8 }}>
              <Bone c={c} w={22} h={22} r={11} />
              <Bone c={c} w="60%" h={10} />
              <Bone c={c} w="80%" h={18} />
            </Shimmer>
          </Glass>
        ))}
      </View>
      <Glass c={c} style={{ padding: 16, marginTop: 10, marginBottom: 14 }}>
        <Shimmer c={c}>
          <Bone c={c} w="40%" h={13} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 8, marginTop: 12 }}>
            {[40, 65, 30, 80, 50, 70, 90].map((h, i) => (
              <Bone key={i} c={c} w={null} h={`${h}%`} r={8} style={{ flex: 1 }} />
            ))}
          </View>
        </Shimmer>
      </Glass>
      <SkeletonRows c={c} rows={4} />
    </View>
  );
}

// Tutarlı boş durum kartı
function EmptyState({ c, icon, title, body, style }) {
  return (
    <Glass c={c} style={[{ alignItems: 'center', paddingVertical: 26, paddingHorizontal: 20, marginTop: 10 }, style]}>
      <Icon name={icon} size={36} color={c.text3} weight="regular" />
      {title ? <Text style={{ color: c.text, fontSize: 17, fontWeight: '700', marginTop: 8, textAlign: 'center' }}>{title}</Text> : null}
      {body ? <Text style={{ color: c.text2, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>{body}</Text> : null}
    </Glass>
  );
}

// ---------------------------------------------------------------------------
// Apple Intelligence (cihaz üstü) arayüz parçaları
// ---------------------------------------------------------------------------
// Degrade yapay zekâ düğmesi (başında sihirli değnek ikonu)
function AiButton({ c, title, sub, onPress, style, compact }) {
  return (
    <Jelly onPress={onPress} scaleTo={0.95} style={style} accessibilityLabel={title}>
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.aiBtn, compact && { height: 44, paddingHorizontal: 18 }]}>
        <View style={s.btnRow}>
          <Icon name="wand.and.stars" size={compact ? 15 : 16} color="#fff" weight="semibold" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: compact ? 15 : 15.5 }} numberOfLines={1}>{title}</Text>
        </View>
        {sub ? <Text style={{ color: '#ffffffcc', fontSize: 12, marginTop: 1 }} numberOfLines={1}>{sub}</Text> : null}
      </LinearGradient>
    </Jelly>
  );
}

// "Düşünüyor" durumu: ışıltılı iskelet satırları + nabız gibi atan başlık
function AiThinking({ c, lines = 4 }) {
  const glow = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.45, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel={t('ai.thinking')}>
      <Animated.Text style={{ color: c.accent, fontWeight: '700', fontSize: 13.5, opacity: glow, marginBottom: 12 }}>{t('ai.thinking')}</Animated.Text>
      <Shimmer c={c} style={{ gap: 9 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <Bone key={i} c={c} w={i === lines - 1 ? '55%' : `${[100, 94, 97][i % 3]}%`} h={12} />
        ))}
      </Shimmer>
    </View>
  );
}

function AiFootnote({ c }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
      <Icon name="lock.fill" size={11} color={c.text3} style={{ marginTop: 2 }} />
      <Text style={{ color: c.text3, fontSize: 11.5, lineHeight: 16, flex: 1 }}>{t('ai.footnote')}</Text>
    </View>
  );
}

// Apple Intelligence kullanılamıyorsa bir kez gösterilen küçük, dostça not (asla hata değil)
function AiHint({ c, status, style }) {
  const [, force] = useState(0);
  if (!shouldShowAiHint(status)) return null;
  return (
    <Glass c={c} tint="#6c5cff1f" style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 }, style]}>
      <Icon name="wand.and.stars" size={18} color={c.accent} />
      <View style={s.flex}>
        <Text style={{ color: c.text, fontWeight: '700', fontSize: 13.5 }}>Apple Intelligence</Text>
        <Text style={{ color: c.text2, fontSize: 12.5, lineHeight: 17, marginTop: 2 }}>{aiHintText(status)}</Text>
      </View>
      <Pressable
        hitSlop={12}
        accessibilityLabel={t('common.close')}
        onPress={() => {
          tap();
          dismissAiHint();
          force((n) => n + 1);
        }}
      >
        <Text style={{ color: c.text3, fontSize: 15 }}>✕</Text>
      </Pressable>
    </Glass>
  );
}

// Görüntüleyicinin altından kayan yapay zekâ paneli.
// ai: { title, status: 'loading' | 'done' | 'error', summary?, points?, text?, error? }
function AiPanel({ c, ai, onClose, onRetry }) {
  const y = useRef(new Animated.Value(500)).current;
  useEffect(() => {
    Animated.spring(y, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }).start();
  }, []);
  const close = () => {
    tap();
    Animated.timing(y, { toValue: 600, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onClose());
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.dark ? '#0008' : '#0003' }]} onPress={close} accessibilityLabel={t('common.close')} />
      <Animated.View style={[s.aiPanel, { transform: [{ translateY: y }] }]}>
        <Glass c={c} style={{ borderRadius: 26, padding: 18, maxHeight: '100%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.aiIcon}>
              <Icon name="wand.and.stars" size={15} color="#fff" weight="semibold" />
            </LinearGradient>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 17, flex: 1, marginLeft: 10 }} numberOfLines={1}>{ai.title}</Text>
            <Pressable onPress={close} hitSlop={12}>
              <Text style={{ color: c.accent, fontWeight: '700', fontSize: 15.5 }}>{t('common.done')}</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 2 }}>
            {ai.status === 'loading' ? (
              <AiThinking c={c} lines={ai.points ? 5 : 3} />
            ) : ai.status === 'error' ? (
              <View style={{ alignItems: 'center', paddingVertical: 6 }}>
                <Icon name="moon.zzz.fill" size={28} color={c.text3} />
                <Text style={{ color: c.text2, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>{ai.error}</Text>
                {onRetry ? (
                  <Pressable onPress={() => (tap(), onRetry())} hitSlop={10} style={{ marginTop: 10 }}>
                    <Text style={{ color: c.accent, fontWeight: '700' }}>{t('ai.retry')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <>
                {ai.summary || ai.text ? <Text style={{ color: c.text, fontSize: 15.5, lineHeight: 23 }} selectable>{ai.summary || ai.text}</Text> : null}
                {ai.points && ai.points.length ? (
                  <>
                    <Text style={[s.dayHeader, { color: c.text3, marginTop: 16, marginLeft: 0 }]}>{t('ai.keyPoints')}</Text>
                    {ai.points.map((p, i) => (
                      <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                        <View style={[s.aiDot, { backgroundColor: c.accentSoft }]}>
                          <Text style={{ color: c.accent, fontWeight: '800', fontSize: 12 }}>{i + 1}</Text>
                        </View>
                        <Text style={{ color: c.text, flex: 1, fontSize: 14.5, lineHeight: 21 }} selectable>{p}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </>
            )}
            <AiFootnote c={c} />
          </ScrollView>
        </Glass>
      </Animated.View>
    </View>
  );
}

// İstatistik sayfasındaki "Haftam" kartı
function AiWeekCard({ c, status, project, history, streak }) {
  const [state, setState] = useState(null); // null | { status, text?, error? }
  const req = useRef(0);
  const week = useMemo(() => computeStats(history).week, [history, lang()]);
  if (status !== 'available') return <AiHint c={c} status={status} style={{ marginTop: 12 }} />;
  const start = async () => {
    const id = ++req.current;
    setState({ status: 'loading' });
    try {
      const text = await weekRecap(`${project.owner}/${project.repo}`, history, week, streak);
      if (id !== req.current) return;
      success();
      setState({ status: 'done', text });
    } catch (e) {
      if (id !== req.current) return;
      warn();
      setState({ status: 'error', error: aiErrorText(e) });
    }
  };
  if (!state) return <AiButton c={c} title={t('ai.myWeek')} sub={t('ai.myWeekSub')} onPress={start} style={{ marginTop: 12 }} />;
  return (
    <Glass c={c} tint="#6c5cff1a" style={{ padding: 16, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.aiIcon}>
          <Icon name="wand.and.stars" size={15} color="#fff" weight="semibold" />
        </LinearGradient>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 16, marginLeft: 10, flex: 1 }}>{t('ai.weekTitle')}</Text>
      </View>
      {state.status === 'loading' ? (
        <AiThinking c={c} lines={3} />
      ) : state.status === 'error' ? (
        <>
          <Text style={{ color: c.text2, lineHeight: 20 }}>{state.error}</Text>
          <Pressable onPress={() => (tap(), start())} hitSlop={10} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
            <Text style={{ color: c.accent, fontWeight: '700' }}>{t('ai.retry')}</Text>
          </Pressable>
        </>
      ) : (
        <Text style={{ color: c.text, fontSize: 15, lineHeight: 22 }} selectable>{state.text}</Text>
      )}
      <AiFootnote c={c} />
    </Glass>
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
  // Dinamik Ada tercihi modül düzeyinde tutulur (pulse() oradan okur)
  useEffect(() => setIslandEnabled(prefs.island !== false), [prefs.island]);
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

  // QR ile eşleştirme: draftrewind://pair?v=1&d=… (Kamera uygulamasıyla okutulur).
  // Jeton hiçbir yerde günlüğe yazılmaz.
  const [pairing, setPairing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const handledUrl = useRef(null);
  // fromScanner: uygulama içi kamera. Dışarıdan gelen bağlantı (başka uygulama/site) açık oturumu
  // sormadan değiştiremez; kullanıcı onaylar.
  const handleUrl = async (url, fromScanner = false) => {
    if (!url || !isPairLink(url) || handledUrl.current === url) return;
    handledUrl.current = url;
    let info;
    try {
      info = decodePairLink(url);
    } catch (e) {
      warn();
      const expired = e && e.code === 'expired';
      Alert.alert(t(expired ? 'pair.expiredTitle' : 'pair.invalidTitle'), t(expired ? 'pair.expired' : 'pair.invalid'), [{ text: t('common.ok') }]);
      return;
    }
    if (!fromScanner && ghUser) {
      const ok = await new Promise((resolve) =>
        Alert.alert(t('pair.replaceTitle'), t('pair.replaceText', { next: info.login || '?', current: ghUser.login }), [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('pair.replaceOk'), onPress: () => resolve(true) },
        ])
      );
      if (!ok) {
        handledUrl.current = null;
        return;
      }
    }
    setPairing(true);
    try {
      const user = await GH.getUser(info.token);
      await loginGithub(info.token);
      setGhUser(user);
      setScreen(null);
      setAccounts(false);
      success();
      pulse({ icon: 'checkmark.circle.fill', color: '#4ade80', title: t('pair.done', { login: user.login }), subtitle: t('pair.doneSub'), short: t('pair.doneShort') }, 5000);
    } catch (e) {
      warn();
      if (!e || !e.auth) handledUrl.current = null; // ağ hatasıysa aynı kod yeniden okutulabilsin
      Alert.alert(t('pair.failedTitle'), e && e.auth ? t('pair.failed') : `${t('pair.failed')}\n\n${e && e.message ? e.message : ''}`.trim(), [{ text: t('common.ok') }]);
    } finally {
      setPairing(false);
    }
  };
  const handleUrlRef = useRef(handleUrl);
  handleUrlRef.current = handleUrl;
  // Kayıtlı oturum yüklendikten sonra dinle (aksi halde eski oturum yenisinin üstüne yazılabilir)
  useEffect(() => {
    if (!ready) return;
    Linking.getInitialURL()
      .then((url) => handleUrlRef.current(url))
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handleUrlRef.current(url));
    return () => sub.remove();
  }, [ready]);

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
        <LoginScreen c={c} onGithub={loginGithub} onGoogle={setGoogle} onScan={() => setScanning(true)} />
      ) : screen && screen.type === 'gh' ? (
        <ProjectScreen c={c} token={ghToken} project={screen.project} onBack={() => setScreen(null)} onAuthError={logoutGithub} />
      ) : screen && screen.type === 'drive' ? (
        <DriveScreen c={c} drive={drive} folder={screen.folder} onBack={() => setScreen(null)} onAuthError={logoutGoogle} />
      ) : (
        <HomeScreen c={c} prefs={prefs} ghToken={ghToken} ghUser={ghUser} google={google} drive={drive} onOpen={setScreen} onAccounts={() => setAccounts(true)} onAuthErrorGh={logoutGithub} onAuthErrorGoogle={logoutGoogle} />
      )}
      <QrScanner c={c} visible={scanning} onClose={() => setScanning(false)} onUrl={(url) => handleUrlRef.current(url, true)} />
      <SettingsSheet
        onScan={() => {
          setAccounts(false);
          setTimeout(() => setScanning(true), 450);
        }}
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
      <BusyHud c={c} text={pairing ? t('pair.connecting') : null} />
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

function LoginScreen({ c, onGithub, onGoogle, onScan }) {
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
        <Animated.View style={{ alignSelf: 'center', transform: [{ rotate }] }}>
          <Icon name="clock.arrow.circlepath" size={72} color={c.accent} weight="medium" />
        </Animated.View>
        <Text style={[s.h1, { color: c.text, textAlign: 'center', marginTop: 14 }]}>DraftRewind</Text>
        <Text style={{ color: c.text2, textAlign: 'center', fontSize: 16, lineHeight: 23, marginTop: 8 }}>
          {t('login.tagline')}
        </Text>
        {gh.flow ? <GithubCodeCard c={c} flow={gh.flow} onCancel={gh.cancel} /> : null}
        {gh.error || go.error ? <Text style={{ color: c.red, textAlign: 'center', marginTop: 16 }}>{gh.error || go.error}</Text> : null}
      </View>
      {!gh.flow ? (
        <View style={{ gap: 12 }}>
          <QrHint c={c} onScan={onScan} />
          <GradientButton icon="chevron.left.forwardslash.chevron.right" title={gh.busy ? t('common.connecting') : t('login.github')} onPress={gh.start} disabled={gh.busy} />
          <SecondaryButton c={c} icon="externaldrive.fill" title={go.busy ? t('common.connecting') : t('login.google')} onPress={go.start} disabled={go.busy} />
          <Text style={{ color: c.text3, textAlign: 'center', fontSize: 12.5 }}>{t('login.hint')}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Uygulama içi QR okuyucu (bazı iPhone'larda Kamera uygulaması özel adresleri göstermiyor)
function QrScanner({ c, visible, onClose, onUrl }) {
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);
  useEffect(() => {
    if (visible) done.current = false;
  }, [visible]);
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.flex, { backgroundColor: '#000' }]}>
        {permission && permission.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current || !data) return;
              if (!isPairLink(data)) return; // başka bir QR: okumaya devam et
              done.current = true;
              tap(Haptics.ImpactFeedbackStyle.Medium);
              onClose();
              onUrl(data);
            }}
          />
        ) : (
          <View style={[s.center, { padding: 30 }]}>
            <Icon name="camera.fill" size={44} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center', marginTop: 12, lineHeight: 22 }}>{t('qr.permission')}</Text>
            <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
              <GradientButton icon="camera.fill" title={t('qr.allow')} onPress={requestPermission} />
            </View>
          </View>
        )}
        <View style={{ position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17, flex: 1 }}>{t('qr.title')}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{t('common.close')}</Text>
          </Pressable>
        </View>
        {permission && permission.granted ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.center]}>
            <View style={{ width: 240, height: 240, borderRadius: 28, borderWidth: 3, borderColor: '#ffffffcc' }} />
            <Text style={{ color: '#fff', marginTop: 18, fontSize: 14, textAlign: 'center', paddingHorizontal: 30 }}>{t('qr.aim')}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// "En hızlısı: QR ile bağlan" kartı
function QrHint({ c, onScan }) {
  return (
    <Jelly onPress={onScan} scaleTo={0.97} disabled={!onScan}>
    <Glass c={c} tint="#6c5cff22" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 4 }}>
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="qrcode.viewfinder" size={22} color="#fff" weight="semibold" />
      </LinearGradient>
      <View style={s.flex}>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 14.5 }}>{t('pair.hintTitle')}</Text>
        <Text style={{ color: c.text2, fontSize: 13, lineHeight: 18, marginTop: 3 }}>{t('pair.hint')}</Text>
        {onScan ? <Text style={{ color: c.accent, fontSize: 13.5, fontWeight: '800', marginTop: 6 }}>{t('qr.scanHere')}</Text> : null}
      </View>
    </Glass>
    </Jelly>
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
function SettingsSheet({ c, prefs, onPrefs, visible, onClose, ghUser, ghToken, google, onGithub, onGoogle, onLogoutGithub, onLogoutGoogle, onScan }) {
  const gh = useGithubLogin(onGithub);
  const go = useGoogleLogin(onGoogle);
  // Yedek uyarıları açılırken bildirim izni istenir; reddedilirse anahtar geri kapanır ve açıklanır
  const toggleBackupAlerts = async (on) => {
    if (!on) return onPrefs({ backupAlerts: false });
    const ok = await ensurePermission();
    if (!ok) {
      warn();
      onPrefs({ backupAlerts: false });
      return Alert.alert(t('notify.deniedTitle'), t('notify.denied'), [{ text: t('common.ok') }]);
    }
    onPrefs({ backupAlerts: true });
  };
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.flex, { backgroundColor: c.bg, padding: 20 }]} testID="settings-sheet">
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
            <View style={s.accountIcon}><Icon name="chevron.left.forwardslash.chevron.right" size={22} color={c.text2} /></View>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>GitHub</Text>
              <Text style={{ color: c.text3 }}>{ghToken ? `@${ghUser ? ghUser.login : '…'}` : t('account.notConnected')}</Text>
            </View>
            <Pressable onPress={ghToken ? onLogoutGithub : gh.start} hitSlop={10}>
              <Text style={{ color: ghToken ? c.red : c.accent, fontWeight: '700' }}>{ghToken ? t('account.logout') : gh.busy ? '…' : t('account.connect')}</Text>
            </Pressable>
          </Glass>
          {!ghToken && !gh.flow ? (
            <Pressable onPress={onScan} hitSlop={6}>
              <Text style={{ color: c.text3, fontSize: 12.5, lineHeight: 17, marginTop: 8, marginHorizontal: 6 }}>{t('pair.settingsHint')} <Text style={{ color: c.accent, fontWeight: '800' }}>{t('qr.scanHere')}</Text></Text>
            </Pressable>
          ) : null}
          {gh.flow ? <GithubCodeCard c={c} flow={gh.flow} onCancel={gh.cancel} /> : null}

          <Glass c={c} style={[s.accountRow, { marginTop: 12 }]}>
            {google && google.user && google.user.picture ? <Image source={{ uri: google.user.picture }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : <View style={s.accountIcon}><Icon name="externaldrive.fill" size={22} color={c.text2} /></View>}
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>Google Drive</Text>
              <Text style={{ color: c.text3 }}>{google ? google.user.email : t('account.notConnected')}</Text>
            </View>
            <Pressable onPress={google ? onLogoutGoogle : go.start} hitSlop={10}>
              <Text style={{ color: google ? c.red : c.accent, fontWeight: '700' }}>{google ? t('account.logout') : go.busy ? '…' : t('account.connect')}</Text>
            </Pressable>
          </Glass>
          {gh.error || go.error ? <Text style={{ color: c.red, marginTop: 14 }}>{gh.error || go.error}</Text> : null}

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
          <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('settings.island')}</Text>
          <Glass c={c} style={s.accountRow}>
            <View style={s.accountIcon}><Icon name="bolt.horizontal.circle.fill" size={22} color={c.text2} /></View>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>{t('settings.islandToggle')}</Text>
              <Text style={{ color: c.text3, fontSize: 12.5, marginTop: 2 }}>{t('settings.islandSub')}</Text>
            </View>
            <Switch value={prefs.island !== false} onValueChange={(island) => onPrefs({ island })} trackColor={{ true: c.accent }} accessibilityLabel={t('settings.islandToggle')} />
          </Glass>
          {!isIslandUsable() ? <Text style={{ color: c.text3, fontSize: 12.5, lineHeight: 17, marginTop: 8, marginHorizontal: 6 }}>{t('settings.islandUnavailable')}</Text> : null}

          <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('settings.notifications')}</Text>
          <Glass c={c} style={s.accountRow}>
            <View style={s.accountIcon}><Icon name="externaldrive.badge.exclamationmark" size={22} color={c.text2} /></View>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>{t('settings.backupAlerts')}</Text>
              <Text style={{ color: c.text3, fontSize: 12.5, marginTop: 2 }}>{t('settings.backupAlertsSub')}</Text>
            </View>
            <Switch value={prefs.backupAlerts !== false} onValueChange={toggleBackupAlerts} trackColor={{ true: c.accent }} accessibilityLabel={t('settings.backupAlerts')} testID="backup-alerts-toggle" />
          </Glass>
          <View style={{ height: 30 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ana ekran: GitHub projeleri + Drive klasörleri
// ---------------------------------------------------------------------------
function HomeScreen({ c, prefs, ghToken, ghUser, google, drive, onOpen, onAccounts, onAuthErrorGh, onAuthErrorGoogle }) {
  const insets = useSafeAreaInsets();
  const [ghList, setGhList] = useState(null);
  const [driveList, setDriveList] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Kapatılmamış "yeni kayıtlar" kartı uygulama yeniden açılsa da kalır; kapatınca bir daha gelmez
  const [news, setNews] = useState(loadPendingNews);
  const dismissNews = () => {
    savePendingNews(null);
    setNews(null);
  };
  // "3 gündür yeni kayıt yok" kartı: { newest } ya da null. O gün kapatılınca gizlenir.
  const [stale, setStale] = useState(null);
  const dismissStale = () => {
    dismissBackupCard();
    setStale(null);
  };
  const backupAlerts = prefs ? prefs.backupAlerts !== false : true;

  const load = useCallback(async () => {
    setError(null);
    const jobs = [];
    if (ghToken)
      jobs.push(
        GH.listProjects(ghToken)
          .then(async (list) => {
            setGhList(list);
            // Yedek sağlığı: en yeni kayıt projelerin son gönderim zamanlarından
            const newest = list.reduce((m, p) => Math.max(m, p.pushedAt || 0), 0);
            checkBackupHealth(newest, backupAlerts)
              .then((r) => setStale(r.stale && r.showCard ? { newest: r.newest } : null))
              .catch(() => {});
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
  }, [ghToken, drive, backupAlerts]);

  useEffect(() => {
    load();
  }, [load]);

  // Uygulama arka plandan her öne geldiğinde yenile (yeni kayıt bildirimi ve yedek sağlığı kontrolü için şart)
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
        <Jelly onPress={onAccounts} scaleTo={0.9} accessibilityLabel={t('settings.title')} testID="settings-button">
          {avatar ? <Image source={{ uri: avatar }} style={s.avatar} /> : <View style={[s.avatar, { backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }]}><Icon name="person.fill" size={20} color={c.accent} /></View>}
        </Jelly>
      </View>

      {stale ? (
        <Jelly onPress={dismissStale} scaleTo={0.97} style={{ marginBottom: 14 }} accessibilityLabel={t('notify.staleBody')} testID="stale-card">
          <Glass c={c} tint="#f9731644" style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="externaldrive.badge.exclamationmark" size={26} color="#f97316" />
            <View style={s.flex}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{t('notify.staleBody')}</Text>
              <Text style={{ color: c.text2, fontSize: 13, marginTop: 3 }} numberOfLines={2}>{t('home.staleSub', { ago: ago(stale.newest) })}</Text>
            </View>
            <Text style={{ color: c.text3 }} accessibilityLabel={t('common.close')}>✕</Text>
          </Glass>
        </Jelly>
      ) : null}

      {news ? (
        <Jelly onPress={dismissNews} scaleTo={0.97} style={{ marginBottom: 14 }}>
          <Glass c={c} tint="#6c5cff44" style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="bell.badge.fill" size={26} color={c.accent} />
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

      {error ? <Text style={{ color: c.red, marginVertical: 10 }}>{error}</Text> : null}
      {loading && !(ghList && ghList.length) && !(driveList && driveList.length) ? <SkeletonRows c={c} rows={3} variant="project" style={{ marginTop: 8 }} /> : null}

      {ghList && ghList.length ? <Text style={[s.dayHeader, { color: c.text3 }]}>{t('home.githubHeader')}</Text> : null}
      {(ghList || []).map((p, i) => (
        <Jelly key={p.repo} onPress={() => onOpen({ type: 'gh', project: { ...p, index: i } })} scaleTo={0.97} style={{ marginBottom: 10 }} accessibilityLabel={p.name} testID="project-row">
          <Glass c={c} interactive style={s.projRow}>
            <LinearGradient colors={projectLook(i).colors} style={s.projTile}>
              <Icon name={projectLook(i).icon} size={24} color="#fff" />
            </LinearGradient>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{p.name}</Text>
              <Text style={{ color: c.text3, fontSize: 13, marginTop: 2 }}>{t('home.lastBackup', { ago: ago(p.pushedAt) })}</Text>
            </View>
            <Text style={{ color: c.text3, fontSize: 22 }}>›</Text>
          </Glass>
        </Jelly>
      ))}

      {driveList && driveList.length ? <Text style={[s.dayHeader, { color: c.text3 }]}>GOOGLE DRIVE</Text> : null}
      {(driveList || []).map((f) => (
        <Jelly key={f.id} onPress={() => onOpen({ type: 'drive', folder: f })} scaleTo={0.97} style={{ marginBottom: 10 }} accessibilityLabel={f.name} testID="project-row">
          <Glass c={c} interactive style={s.projRow}>
            <LinearGradient colors={DRIVE_LOOK.colors} style={s.projTile}>
              <Icon name={DRIVE_LOOK.icon} size={24} color="#fff" />
            </LinearGradient>
            <View style={s.flex}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{f.name}</Text>
              <Text style={{ color: c.text3, fontSize: 13, marginTop: 2 }}>{t('home.updated', { ago: ago(f.modified) })}</Text>
            </View>
            <Text style={{ color: c.text3, fontSize: 22 }}>›</Text>
          </Glass>
        </Jelly>
      ))}

      {empty ? <EmptyState c={c} icon="leaf.fill" title={t('home.emptyTitle')} body={t('home.emptyBody')} /> : null}
    </ScrollView>
  );
}

// Telefonda en son bakıldığından beri bilgisayarda yeni kayıt olduysa Dinamik Ada'da kısaca göster.
// Aynı anda birden çok yükleme (açılış + öne gelme + aşağı çekme) aynı kayıtları iki kez duyurmasın diye tek iş.
// Dönen değer: kapatılmamış tüm yeni kayıt kartı öğeleri (kalıcı) — yeni bir şey yoksa boş dizi.
let announcing = null;
function announceNewSaves(token, list) {
  if (!announcing) announcing = doAnnounceNewSaves(token, list).finally(() => (announcing = null));
  return announcing;
}

async function doAnnounceNewSaves(token, list) {
  const seen = loadSeen();
  const firstRun = Object.keys(seen).length === 0;
  const news = [];
  for (const p of list) {
    const key = `${p.owner}/${p.repo}`;
    const last = seen[key] || 0;
    let checked = true;
    if (!firstRun && p.pushedAt > last) {
      try {
        // Telefondan eklenen dosyalar ve birleştirmeler "yeni kayıt" sayılmaz
        const snaps = (await GH.listSnapshots(token, p, 1)).filter((s) => s.time > last && s.kind !== 'merge' && s.kind !== 'mobile');
        if (snaps.length) {
          const words = snaps.reduce((a, s) => a + Object.values(s.delta || {}).reduce((x, y) => x + y, 0), 0);
          news.push({ key, name: p.name, count: snaps.length, words, title: snaps[0].title });
        }
      } catch (e) {
        checked = false; // ağ hatası: bir dahaki sefere yeniden bak
      }
    }
    if (checked) seen[key] = Math.max(last, p.pushedAt);
  }
  saveSeen(seen);
  if (!news.length) return news;
  // Kapatılmamış eski kartla birleştir ve kalıcı kaydet
  const pending = loadPendingNews() || [];
  for (const n of news) {
    const old = pending.find((x) => x.key === n.key);
    if (old) {
      old.count += n.count;
      old.words += n.words;
      old.title = n.title;
    } else pending.unshift(n);
  }
  savePendingNews(pending);
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
  return pending;
}

// ---------------------------------------------------------------------------
// GitHub proje ayrıntısı
// ---------------------------------------------------------------------------
const touchesFile = (h, path) => (h.changed || []).includes(path) || (h.delta && h.delta[path] !== undefined) || (h.deleted || []).includes(path);

function ProjectScreen({ c, token, project, onBack, onAuthError }) {
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState(null);
  const [files, setFiles] = useState(null);
  const [tab, setTab] = useState('time');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [busy, setBusy] = useState(null);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef(null);
  const tabsY = useRef(0);

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
  const baseName = (path) => path.split('/').pop();
  const openFile = (path, ref, time) =>
    setViewer({
      name: baseName(path),
      shareName: ref ? versionName(baseName(path), time) : baseName(path),
      subtitle: ref ? t('project.oldVersion') : t('project.current'),
      size: sizeOf(path),
      aiId: `${project.owner}/${project.repo}@${ref || 'HEAD'}:${path}`,
      load: () => GH.fileContent(token, project, path, ref),
    });
  // autoAi: "Neler değişti?" ile açıldıysa özet kendiliğinden başlar
  const openDiff = (path, ref, parentRef, autoAi) =>
    setViewer({
      name: baseName(path),
      subtitle: t('project.whatChanged'),
      aiId: `${project.owner}/${project.repo}@${ref}:${path}`,
      autoAi: !!autoAi,
      diff: {
        // Yalnızca "önceki sürümde yoktu" (404) boş sayılır; ağ hatası gerçek hata olarak görünür
        loadOld: () => (parentRef ? GH.fileContent(token, project, path, parentRef).catch((e) => (e && e.status === 404 ? null : Promise.reject(e))) : Promise.resolve(null)),
        loadNew: () => GH.fileContent(token, project, path, ref),
      },
    });
  const shareFile = (path, ref, time) => shareDoc(setBusy, ref ? versionName(baseName(path), time) : baseName(path), () => GH.fileContent(token, project, path, ref));
  const showHistory = (path) => {
    setSnapshot(null);
    setTab('time');
    setFileFilter(path);
    setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: Math.max(0, tabsY.current - 8), animated: true }), 350);
  };
  const docActions = (path) =>
    showActions(c, {
      title: baseName(path),
      actions: [
        { label: t('doc.preview'), onPress: () => openFile(path, null) },
        { label: t('doc.share'), onPress: () => shareFile(path, null) },
        { label: t('doc.history'), onPress: () => showHistory(path) },
      ],
    });

  // Kameradan sonra "Bir tane daha?" sorusu (Alert ile evet/hayır)
  const askAnotherPhoto = (n) =>
    new Promise((resolve) =>
      Alert.alert(t('upload.anotherTitle'), t('upload.anotherBody', { n, count: n }), [
        { text: t('upload.anotherNo'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('upload.anotherYes'), onPress: () => resolve(true) },
      ])
    );

  // Telefondan dosya/fotoğraf ekleme → "Telefondan eklenenler/" klasörüne tek kayıt olarak.
  // pick: dosya seçici, kamera ya da galeri — hepsi aynı yükleme yolunu kullanır.
  const addFiles = async (pick = pickFiles) => {
    let picked;
    try {
      picked = await pick();
    } catch (e) {
      warn();
      Alert.alert(e && e.denied ? t('upload.cameraDeniedTitle') : t('upload.failedTitle'), e && e.message ? e.message : String(e), [{ text: t('common.ok') }]);
      return;
    }
    if (!picked.length) return;
    const tooBig = picked.filter((a) => a.size > MAX_UPLOAD);
    const ok = picked.filter((a) => a.size <= MAX_UPLOAD);
    tooBig.forEach(discardPicked);
    if (tooBig.length) {
      warn();
      Alert.alert(t('upload.tooBigTitle'), tooBig.map((a) => (a.sizeUnknown ? t('upload.sizeUnknown', { name: a.name }) : t('upload.tooBig', { name: a.name, size: mb(a.size) }))).join('\n\n'), [{ text: t('common.ok') }]);
    }
    if (!ok.length) return;
    setUploading(true);
    const n = ok.length;
    const island = pulse({ icon: 'arrow.up.circle', color: '#38bdf8', title: n === 1 ? ok[0].name : project.name, subtitle: t('upload.progress', { i: 1, n }), short: t('upload.progressShort', { i: 1, n }) }, 180000);
    const taken = new Set((files || []).map((f) => f.path));
    const done = [];
    let failure = null;
    try {
      // Aynı adlı dosya varsa "ad (2).uzantı"; seçilenlerin kendi arasında çakışması da önlenir
      const jobs = [];
      for (const a of ok) {
        const name = await uniqueName(safeName(a.name), async (candidate) => {
          const p = `${PHONE_FOLDER}/${candidate}`;
          return taken.has(p) || (await GH.pathExists(token, project, p));
        });
        const path = `${PHONE_FOLDER}/${name}`;
        taken.add(path);
        jobs.push({ path, read: () => readBase64(a) });
      }
      const nameOf = (path) => path.slice(PHONE_FOLDER.length + 1);
      const r = await GH.addFiles(
        token,
        project,
        jobs,
        (paths) => {
          const names = paths.map(nameOf);
          const title = names.length <= 2 ? names.join(', ') : t('upload.doneMany', { n: names.length });
          return `${t('upload.fromPhone')}: ${title}\n\nacadamiv: ${JSON.stringify({ v: 1, kind: 'mobile', changed: paths })}`;
        },
        (i) => i > 0 && island.update({ subtitle: t('upload.progress', { i: i + 1, n }), short: t('upload.progressShort', { i: i + 1, n }) })
      );
      done.push(...r.done.map(nameOf));
      if (r.failed.length) failure = new Error(r.failed.map((f) => `${nameOf(f.path)}: ${f.error.message}`).join('\n\n'));
    } catch (e) {
      failure = e;
    } finally {
      ok.forEach(discardPicked);
    }
    setUploading(false);
    if (done.length) {
      success();
      island.finish({ icon: 'checkmark.circle.fill', color: '#4ade80', title: done.length === 1 ? t('upload.doneOne', { name: done[0] }) : t('upload.doneMany', { n: done.length }), subtitle: t('upload.doneSub'), short: t('upload.doneShort') }, 5000);
      await load();
    } else island.finish({ icon: 'exclamationmark.triangle', color: '#f87171', subtitle: failure ? failure.message : '', short: t('upload.failedShort') });
    if (failure) {
      warn();
      if (failure.auth) onAuthError();
      else Alert.alert(t('upload.failedTitle'), failure.message, [{ text: t('common.ok') }]);
    }
  };

  const language = lang();
  const stats = useMemo(() => (history ? computeStats(history) : null), [history, language]);
  const words = useMemo(() => (history ? latestWords(history) : {}), [history]);
  // Her dosyanın en son değiştiği kayıt zamanı (yüklenen kayıtlardan)
  const lastChanged = useMemo(() => {
    const m = {};
    for (const h of history || []) for (const p of [...(h.changed || []), ...Object.keys(h.delta || {})]) if (m[p] === undefined) m[p] = h.time;
    return m;
  }, [history]);
  const visibleFiles = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLocaleLowerCase(locale());
    const list = q ? files.filter((f) => f.path.toLocaleLowerCase(locale()).includes(q)) : [...files];
    const byName = (a, b) => (kindOf(a.path) === 'word' ? -1 : 0) - (kindOf(b.path) === 'word' ? -1 : 0) || a.path.localeCompare(b.path, language);
    if (sort === 'changed') list.sort((a, b) => (lastChanged[b.path] || 0) - (lastChanged[a.path] || 0) || byName(a, b));
    else if (sort === 'size') list.sort((a, b) => b.size - a.size || byName(a, b));
    else list.sort(byName);
    return list;
  }, [files, language, query, sort, lastChanged]);
  const shownHistory = useMemo(() => (history ? (fileFilter ? history.filter((h) => touchesFile(h, fileFilter)) : history) : []), [history, fileFilter]);
  const maxWeek = stats ? Math.max(1, ...stats.week.map((w) => w.words)) : 1;
  // Başlık alt satırı: son kayıt zamanı (yüklenene kadar GitHub'daki son gönderim) · dosya sayısı
  const lastSave = history && history.length ? t('project.lastSave', { ago: ago(history[0].time) }) : project.pushedAt ? t('home.lastBackup', { ago: ago(project.pushedAt) }) : '';
  const headerSub = [lastSave, files ? t('project.fileCount', { n: files.length, count: files.length }) : ''].filter(Boolean).join(' · ');

  let lastDay = '';
  return (
    <View style={s.flex}>
      <ScrollView
        ref={scrollRef}
        style={s.flex}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
        <ScreenHeader
          c={c}
          onBack={onBack}
          backLabel={t('nav.projects')}
          right={
            files ? (
              <AddButton
                c={c}
                busy={uploading}
                options={[
                  { label: t('upload.files'), onPress: () => addFiles(pickFiles) },
                  { label: t('upload.takePhoto'), onPress: () => addFiles(() => takePhotos(askAnotherPhoto)) },
                  { label: t('upload.choosePhotos'), onPress: () => addFiles(pickPhotos) },
                ]}
              />
            ) : null
          }
          look={projectLook(project.index)}
          eyebrow={t('project.eyebrow')}
          title={project.name}
          subtitle={headerSub}
        />

        {error ? <Text style={{ color: c.red, marginBottom: 12 }}>{error}</Text> : null}
        {!stats && !error ? <ProjectSkeleton c={c} /> : null}

        {stats ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StatCard c={c} icon="flame.fill" label={t('stats.streak')} value={t('stats.days', { n: stats.streak, count: stats.streak })} hot onPress={() => setStatsOpen(true)} />
              <StatCard c={c} icon="pencil.line" label={t('stats.today')} value={`+${num(Math.max(0, stats.today))}`} onPress={() => setStatsOpen(true)} />
              <StatCard c={c} icon="text.word.spacing" label={t('stats.words')} value={num(stats.total)} onPress={() => setStatsOpen(true)} />
            </View>

            <Jelly onPress={() => setStatsOpen(true)} scaleTo={0.98} style={{ marginTop: 10 }}>
              <Glass c={c} interactive style={{ padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 15, flex: 1 }}>{t('stats.thisWeek')}</Text>
                  <Text style={{ color: c.text3, fontSize: 12 }}>{t('stats.tapHint')} ›</Text>
                </View>
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
            </Jelly>

            <View onLayout={(e) => (tabsY.current = e.nativeEvent.layout.y)}>
              <Glass c={c} style={[s.seg, { marginTop: 14 }]}>
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
            </View>

            {tab === 'time' && fileFilter ? (
              <Glass c={c} tint={c.accent + '22'} style={[s.tlItem, { marginTop: 6, paddingVertical: 10 }]}>
                <FileBadge name={fileFilter} size={30} />
                <Text style={{ color: c.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>{t('history.filter', { name: baseName(fileFilter) })}</Text>
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    tap();
                    setFileFilter(null);
                  }}
                >
                  <Text style={{ color: c.accent, fontWeight: '700' }}>{t('history.showAll')}</Text>
                </Pressable>
              </Glass>
            ) : null}
            {tab === 'time' && fileFilter && !shownHistory.length ? <EmptyState c={c} icon="clock.arrow.circlepath" title={t('empty.noChanges')} body={t('history.empty')} /> : null}

            {tab === 'time'
              ? shownHistory.map((h, idx) => {
                  const d = dayLabel(h.time);
                  const header = d !== lastDay ? d : null;
                  lastDay = d;
                  const w = fileFilter ? (h.delta || {})[fileFilter] || 0 : Object.values(h.delta || {}).reduce((a, b) => a + b, 0);
                  return (
                    <View key={h.oid}>
                      {header ? <Text style={[s.dayHeader, { color: c.text3 }]}>{header.toUpperCase()}</Text> : null}
                      <Jelly onPress={() => setSnapshot(h)} scaleTo={0.98} style={{ marginBottom: 8 }} accessibilityLabel={h.title} testID={idx === 0 ? 'snapshot-row' : undefined}>
                        <Glass c={c} interactive tint={h.kind === 'star' ? '#ffb93833' : undefined} style={s.tlItem}>
                          <View style={[s.node, { backgroundColor: h.kind === 'star' ? '#ffb938' : c.accentSoft }]}>
                            <Icon name={kindIcon(h.kind)} size={14} color={h.kind === 'star' ? '#fff' : c.accent} weight="semibold" />
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
              : (
                <>
                  <Glass c={c} style={[s.searchBox, { marginTop: 8 }]}>
                    <Icon name="magnifyingglass" size={16} color={c.text3} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder={t('docs.search')}
                      placeholderTextColor={c.text3}
                      style={{ flex: 1, color: c.text, fontSize: 15.5, paddingVertical: 0 }}
                      clearButtonMode="while-editing"
                      autoCorrect={false}
                      autoCapitalize="none"
                      returnKeyType="search"
                      keyboardAppearance={c.dark ? 'dark' : 'light'}
                    />
                  </Glass>
                  <View style={{ marginTop: 8 }}>
                    <Segmented
                      c={c}
                      value={sort}
                      onChange={setSort}
                      options={[
                        ['name', t('docs.sortName')],
                        ['changed', t('docs.sortChanged')],
                        ['size', t('docs.sortSize')],
                      ]}
                    />
                  </View>
                  {query && !visibleFiles.length ? <EmptyState c={c} icon="magnifyingglass" title={t('empty.noResults')} body={t('docs.noMatch', { q: query.trim() })} /> : null}
                  {visibleFiles.map((f) => (
                    <Jelly key={f.path} onPress={() => openFile(f.path, null)} onLongPress={() => docActions(f.path)} scaleTo={0.98} style={{ marginTop: 8 }}>
                      <Glass c={c} interactive style={s.tlItem}>
                        <FileBadge name={f.path} />
                        <View style={s.flex}>
                          <Text style={{ color: c.text, fontWeight: '600', fontSize: 14.5 }} numberOfLines={1}>{baseName(f.path)}</Text>
                          <Text style={{ color: c.text3, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                            {f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) + ' · ' : ''}
                            {words[f.path] != null ? t('words.count', { n: num(words[f.path]), count: words[f.path] }) : `${Math.max(1, Math.round(f.size / 1024))} KB`}
                            {sort === 'changed' && lastChanged[f.path] ? ` · ${ago(lastChanged[f.path])}` : ''}
                          </Text>
                        </View>
                        <Text style={{ color: c.text3, fontSize: 20 }}>›</Text>
                      </Glass>
                    </Jelly>
                  ))}
                  {visibleFiles.length ? <Text style={{ color: c.text3, fontSize: 12, textAlign: 'center', marginTop: 16 }}>{t('docs.longPressHint')}</Text> : null}
                </>
              )}
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
        onShowHistory={showHistory}
        viewer={viewer}
        onCloseViewer={() => setViewer(null)}
      />
      {/* iOS'ta açık bir sayfanın üstüne ikinci sayfa açılamaz: kayıt ayrıntısı açıkken görüntüleyici onun içinde */}
      {!snapshot ? <ViewerSheet c={c} target={viewer} onClose={() => setViewer(null)} /> : null}
      {history ? <StatsSheet c={c} visible={statsOpen} onClose={() => setStatsOpen(false)} token={token} project={project} history={history} /> : null}
      <BusyHud c={c} text={busy} />
    </View>
  );
}

function StatCard({ c, icon, label, value, hot, onPress }) {
  return (
    <Jelly onPress={onPress} scaleTo={0.94} style={s.flex}>
      <Glass c={c} interactive style={{ padding: 14 }}>
        <Icon name={icon} size={20} color={hot ? '#ff7a45' : c.accent} />
        <Text style={{ color: c.text3, fontSize: 12, fontWeight: '600', marginTop: 6 }}>{label}</Text>
        <Text style={{ color: hot ? '#ff7a45' : c.text, fontSize: 20, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </Glass>
    </Jelly>
  );
}

// ---------------------------------------------------------------------------
// İstatistikler sayfası (seri / bugün / kelime kartlarına dokununca)
// ---------------------------------------------------------------------------
const HEAT_WEEKS = 16;

function StatsSheet({ c, visible, onClose, token, project, history }) {
  const [hist, setHist] = useState(history);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sel, setSel] = useState(null);
  const [gridW, setGridW] = useState(0);
  const aiStatus = useAiStatus();

  useEffect(() => setHist(history), [history]);

  // 16 hafta için yüklenen kayıtlar yetmiyorsa (sayfa dolu ve en eskisi yeterince eski değil) daha fazlasını getir
  useEffect(() => {
    if (!visible || !history.length) return;
    const cutoff = Date.now() - (HEAT_WEEKS * 7 + 7) * 86400000;
    const oldest = history[history.length - 1].time;
    if (oldest <= cutoff || history.length % 100 !== 0) return;
    let alive = true;
    setLoadingMore(true);
    GH.listSnapshots(token, project, 10, cutoff)
      .then((more) => alive && more.length > history.length && setHist(more))
      .catch(() => {})
      .finally(() => alive && setLoadingMore(false));
    return () => {
      alive = false;
    };
  }, [visible, history]);

  const language = lang();
  const ds = useMemo(() => deepStats(hist, { weeks: HEAT_WEEKS, weekStart: language === 'tr' ? 1 : 0 }), [hist, language, visible]);
  if (!visible) return null;

  const heat = [c.dark ? '#ffffff14' : '#1c1a3312', c.accent + '47', c.accent + '80', c.accent + 'bb', c.accent];
  const gap = 3;
  const labelW = 26;
  const cell = gridW ? Math.max(8, Math.floor((gridW - labelW - (HEAT_WEEKS - 1) * gap) / HEAT_WEEKS)) : 0;
  const weekStart = language === 'tr' ? 1 : 0;
  const max30 = Math.max(1, ...ds.last30.map((d) => d.words));
  const maxFile = Math.max(1, ...ds.perFile.map((f) => f.words));
  const unlocked = ds.badges.filter((b) => b.done).length;
  const pad2 = (n) => String(n).padStart(2, '0');
  const pick = (cellData) => {
    tap();
    setSel(cellData);
  };
  const selText = sel
    ? sel.words > 0
      ? t('stats.dayWords', { date: shortDate(sel.time), words: t('words.count', { n: '+' + num(sel.words), count: sel.words }) })
      : t(sel.active ? 'stats.dayActive' : 'stats.dayNone', { date: shortDate(sel.time) })
    : t('stats.tapDay');

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.flex, { backgroundColor: c.bg }]}>
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <View style={s.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={s.flex}>
              <Text style={[s.h2, { color: c.text }]}>{t('stats.title')}</Text>
              <Text style={{ color: c.text3, marginTop: 2 }} numberOfLines={1}>{project.name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: c.accent, fontWeight: '700', fontSize: 16 }}>{t('common.done')}</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 10, paddingBottom: 50 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Glass c={c} tint="#ff7a4522" style={[s.flex, { padding: 16 }]}>
              <Icon name="flame.fill" size={24} color="#ff7a45" />
              <Text style={{ color: c.text3, fontSize: 12, fontWeight: '600', marginTop: 6 }}>{t('stats.currentStreak')}</Text>
              <Text style={{ color: '#ff7a45', fontSize: 24, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
                {t('stats.days', { n: ds.streak, count: ds.streak })}
              </Text>
            </Glass>
            <Glass c={c} tint="#ffb93822" style={[s.flex, { padding: 16 }]}>
              <Icon name="trophy.fill" size={24} color="#f59e0b" />
              <Text style={{ color: c.text3, fontSize: 12, fontWeight: '600', marginTop: 6 }}>{t('stats.bestStreak')}</Text>
              <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
                {t('stats.days', { n: ds.bestStreak, count: ds.bestStreak })}
              </Text>
            </Glass>
          </View>

          {/* Haftam (cihaz üstü Apple Intelligence) */}
          <AiWeekCard c={c} status={aiStatus} project={project} history={hist} streak={ds.streak} />

          {/* GitHub tarzı ısı haritası */}
          <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('stats.heatmap')}</Text>
          <Glass c={c} style={{ padding: 16 }}>
            <View onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
              {cell ? (
                <>
                  <View style={{ flexDirection: 'row', marginLeft: labelW, height: 16 }}>
                    {ds.columns.map((col, i) => (
                      <View key={i} style={{ width: cell, marginRight: i < HEAT_WEEKS - 1 ? gap : 0, overflow: 'visible' }}>
                        {col.showMonth ? (
                          <Text style={{ color: c.text3, fontSize: 10, fontWeight: '600', width: 40 }} numberOfLines={1}>
                            {t('months')[col.month]}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ width: labelW }}>
                      {[0, 1, 2, 3, 4, 5, 6].map((r) => (
                        <View key={r} style={{ height: cell, marginBottom: r < 6 ? gap : 0, justifyContent: 'center' }}>
                          {r % 2 === 1 ? <Text style={{ color: c.text3, fontSize: 9.5, fontWeight: '600' }}>{t('days')[(weekStart + r) % 7]}</Text> : null}
                        </View>
                      ))}
                    </View>
                    {ds.columns.map((col, i) => (
                      <View key={i} style={{ marginRight: i < HEAT_WEEKS - 1 ? gap : 0 }}>
                        {col.cells.map((cd, r) => (
                          <Pressable
                            key={r}
                            disabled={!cd}
                            onPress={() => pick(cd)}
                            hitSlop={1}
                            style={{
                              width: cell,
                              height: cell,
                              marginBottom: r < 6 ? gap : 0,
                              borderRadius: Math.max(2, cell * 0.28),
                              backgroundColor: cd ? heat[cd.level] : 'transparent',
                              borderWidth: sel && cd && sel.time === cd.time ? 1.5 : 0,
                              borderColor: c.text,
                            }}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <View style={{ height: 150 }} />
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4 }}>
              <Text style={{ color: sel ? c.text : c.text3, fontSize: 12.5, fontWeight: sel ? '700' : '500', flex: 1 }} numberOfLines={2}>
                {selText}
              </Text>
              <Text style={{ color: c.text3, fontSize: 10.5, marginRight: 2 }}>{t('stats.less')}</Text>
              {heat.map((col, i) => (
                <View key={i} style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: col }} />
              ))}
              <Text style={{ color: c.text3, fontSize: 10.5, marginLeft: 2 }}>{t('stats.more')}</Text>
            </View>
            {loadingMore ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <ActivityIndicator size="small" color={c.accent} />
                <Text style={{ color: c.text3, fontSize: 12 }}>{t('stats.loadingMore')}</Text>
              </View>
            ) : null}
          </Glass>

          {/* Son 30 gün */}
          <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('stats.last30')}</Text>
          <Glass c={c} style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 2 }}>
              {ds.last30.map((d, i) => {
                const h = d.words ? Math.max(6, (d.words / max30) * 100) : 3;
                const on = sel && sel.time === d.time;
                return (
                  <Pressable key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }} onPress={() => pick({ ...d, active: d.words > 0 })}>
                    {i === 29 || on ? (
                      <LinearGradient colors={GRAD} style={{ height: `${h}%`, borderRadius: 3 }} />
                    ) : (
                      <View style={{ height: `${h}%`, borderRadius: 3, backgroundColor: d.words ? c.accent + '88' : c.border }} />
                    )}
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <Text style={{ color: c.text3, fontSize: 10.5, flex: 1 }}>{shortDate(ds.last30[0].time)}</Text>
              <Text style={{ color: c.text3, fontSize: 10.5, flex: 1, textAlign: 'center' }}>{shortDate(ds.last30[15].time)}</Text>
              <Text style={{ color: c.text3, fontSize: 10.5, flex: 1, textAlign: 'right' }}>{t('stats.today')}</Text>
            </View>
          </Glass>

          {/* Küçük özet kutuları */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            <MiniStat c={c} icon="bolt.fill" label={t('stats.bestDay')} value={ds.bestDay ? `+${num(ds.bestDay.words)}` : t('stats.none')} sub={ds.bestDay ? shortDate(ds.bestDay.time) : ''} />
            <MiniStat c={c} icon="clock.fill" label={t('stats.bestHour')} value={ds.bestHour != null ? `${pad2(ds.bestHour)}:00` : t('stats.none')} sub={ds.bestHour != null ? `${pad2(ds.bestHour)}:00–${pad2((ds.bestHour + 1) % 24)}:00` : ''} />
            <MiniStat c={c} icon="chart.line.uptrend.xyaxis" label={t('stats.avgActive')} value={num(ds.avgActive)} sub={t('stats.avgUnit')} />
            <MiniStat c={c} icon="clock.arrow.circlepath" label={t('stats.savePoints')} value={num(ds.saves)} sub={t('stats.words') + ': ' + num(ds.total)} />
          </View>

          {/* Rozetler */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 22 }}>
            <Text style={[s.dayHeader, { color: c.text3, marginTop: 0, flex: 1 }]}>{t('stats.badges')}</Text>
            <Text style={{ color: c.accent, fontSize: 12, fontWeight: '700', marginRight: 4 }}>{t('stats.badgesCount', { n: unlocked, total: ds.badges.length })}</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {ds.badges.map((b) => (
              // Genişlik dıştaki View'a verilmeli: Jelly'nin Pressable'ı boyutsuz olduğu için yüzde içeride çöküyordu
              <View key={b.id} style={{ width: '22%', flexGrow: 1 }}>
              <Jelly
                scaleTo={0.9}
                onPress={() => {
                  if (b.done) success();
                  Alert.alert(t('badge.' + b.id), t('badge.' + b.id + '.d'));
                }}
              >
                <Glass c={c} tint={b.done ? '#ffb93826' : undefined} style={{ alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderRadius: 18 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: b.done ? '#ffb93833' : c.dark ? '#ffffff10' : '#1c1a330d' }}>
                    <Icon name={b.done ? b.icon : 'lock.fill'} size={b.done ? 22 : 18} color={b.done ? '#f59e0b' : c.text3} style={{ opacity: b.done ? 1 : 0.6 }} />
                  </View>
                  <Text style={{ color: b.done ? c.text : c.text3, fontSize: 11.5, fontWeight: '700', marginTop: 6, textAlign: 'center' }} numberOfLines={2}>
                    {t('badge.' + b.id)}
                  </Text>
                </Glass>
              </Jelly>
              </View>
            ))}
          </View>

          {/* Kilometre taşları */}
          <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('stats.milestones')}</Text>
          {ds.milestones.length ? (
            ds.milestones.map((m) => (
              <Glass key={m.oid} c={c} tint="#ffb93822" style={[s.tlItem, { marginBottom: 8 }]}>
                <View style={[s.node, { backgroundColor: '#ffb938' }]}>
                  <Icon name="star.fill" size={14} color="#fff" weight="semibold" />
                </View>
                <View style={s.flex}>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14.5 }} numberOfLines={2}>{m.title}</Text>
                  <Text style={{ color: c.text3, fontSize: 12, marginTop: 2 }}>{`${shortDate(m.time)} · ${hm(m.time)}`}</Text>
                </View>
              </Glass>
            ))
          ) : (
            <Glass c={c} style={{ padding: 16 }}>
              <Text style={{ color: c.text2, lineHeight: 20 }}>{t('stats.noMilestones')}</Text>
            </Glass>
          )}

          {/* Dosya başına kelime */}
          {ds.perFile.length ? (
            <>
              <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('stats.perFile')}</Text>
              <Glass c={c} style={{ padding: 16, gap: 12 }}>
                {ds.perFile.map((f) => (
                  <View key={f.path}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                      <Text style={{ color: c.text, fontWeight: '600', flex: 1, fontSize: 13.5 }} numberOfLines={1}>{f.path.split('/').pop()}</Text>
                      <Text style={{ color: c.text2, fontWeight: '700', fontSize: 13 }}>{num(f.words)}</Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: c.dark ? '#ffffff10' : '#1c1a330d', overflow: 'hidden' }}>
                      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.max(3, (f.words / maxFile) * 100)}%`, height: '100%', borderRadius: 4 }} />
                    </View>
                  </View>
                ))}
              </Glass>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function MiniStat({ c, icon, label, value, sub }) {
  return (
    <Glass c={c} style={{ flexGrow: 1, flexBasis: '45%', padding: 14 }}>
      <Icon name={icon} size={20} color={c.accent} />
      <Text style={{ color: c.text3, fontSize: 12, fontWeight: '600', marginTop: 6 }} numberOfLines={1}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 21, fontWeight: '800', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={{ color: c.text3, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>{sub}</Text> : null}
    </Glass>
  );
}

function SnapshotSheet({ c, token, project, snapshot, onClose, onOpenFile, onOpenDiff, onShowHistory, viewer, onCloseViewer }) {
  const [files, setFiles] = useState(null);
  const [parent, setParent] = useState(null);
  const [busy, setBusy] = useState(null);
  const aiStatus = useAiStatus();
  const worker = useDiffWorker();
  const reportReq = useRef(0);
  useEffect(() => {
    if (!snapshot) return;
    setFiles(null);
    setParent(null);
    reportReq.current++;
    setBusy(null);
    GH.commitFiles(token, project, snapshot.oid)
      .then((r) => {
        setFiles(r.files);
        setParent(r.parent);
      })
      .catch(() => setFiles([]));
  }, [snapshot]);
  if (!snapshot) return null;
  const d = new Date(snapshot.time);
  // "Neler değişti?": en çok değişen karşılaştırılabilir (Word/metin) dosyanın farkı açılır ve özetlenir
  const sdelta = snapshot.delta || {};
  const diffable = (f) => f.status !== 'removed' && (kindOf(f.path) === 'word' || kindOf(f.path) === 'text');
  const reportFiles = files ? files.filter(diffable).sort((a, b) => Math.abs(sdelta[b.path] || 0) - Math.abs(sdelta[a.path] || 0)) : [];

  // Değişiklik raporu: farklar gizli WebView'da sırayla çizilir → tek PDF → paylaşım sayfası.
  // İlk REPORT_MAX_FILES dosya ve dosya başına REPORT_MAX_BLOCKS blokla sınırlı (koca tez telefonu kilitlemesin).
  const sendReport = async () => {
    if (!reportFiles.length || busy) return;
    const id = ++reportReq.current;
    const alive = () => id === reportReq.current;
    const chosen = reportFiles.slice(0, REPORT_MAX_FILES);
    try {
      const libs = await loadViewerLibs(LIBS_FOR.diff);
      const items = [];
      for (let i = 0; i < chosen.length; i++) {
        if (!alive()) return;
        const f = chosen[i];
        const name = f.path.split('/').pop();
        setBusy(t('report.preparing', { i: i + 1, n: chosen.length }));
        let item = { name, status: f.status, failed: true };
        try {
          const [oldBuf, newBuf] = await Promise.all([
            // Yalnızca "önceki sürümde yoktu" (404) boş sayılır; ağ hatası gerçek hata olarak görünür
            f.status === 'added' || !parent ? Promise.resolve(null) : GH.fileContent(token, project, f.path, parent).catch((e) => (e && e.status === 404 ? null : Promise.reject(e))),
            GH.fileContent(token, project, f.path, snapshot.oid),
          ]);
          if (!alive()) return;
          const html = diffHtml(oldBuf ? arrayBufferToBase64(oldBuf) : null, arrayBufferToBase64(newBuf), kindOf(name), false, viewerLabels(), libs, { report: true, maxBlocks: REPORT_MAX_BLOCKS });
          const r = await worker.render(html);
          if (!alive()) return;
          if (r && !r.failed) item = { name, status: f.status, html: r.html || '', add: r.add || 0, rem: r.rem || 0, unchanged: !!r.unchanged, truncated: !!r.truncated };
        } catch (e) {
          if (e && e.auth) throw e;
        }
        items.push(item);
      }
      setBusy(t('report.rendering'));
      const pdf = await htmlToPdf(reportHtml({ projectName: project.name, snapshot, items, totalFiles: reportFiles.length }));
      if (!alive()) return;
      setBusy(null);
      success();
      await shareBuffer(reportFileName(project.name, snapshot.time), pdf);
    } catch (e) {
      if (!alive()) return;
      setBusy(null);
      warn();
      Alert.alert(t('report.failedTitle'), e && e.message ? e.message : String(e), [{ text: t('common.ok') }]);
    }
  };
  const aiFile =
    aiStatus === 'available' && files
      ? files
          .filter((f) => f.status !== 'removed' && (kindOf(f.path) === 'word' || kindOf(f.path) === 'text'))
          .sort((a, b) => Math.abs(sdelta[b.path] || 0) - Math.abs(sdelta[a.path] || 0))[0]
      : null;
  const fileActions = (f, canDiff) =>
    showActions(c, {
      title: f.path.split('/').pop(),
      actions: [
        { label: t('doc.previewVersion'), onPress: () => onOpenFile(f.path, snapshot.oid, snapshot.time) },
        {
          label: t('doc.shareVersion'),
          onPress: () => shareDoc(setBusy, versionName(f.path.split('/').pop(), snapshot.time), () => GH.fileContent(token, project, f.path, snapshot.oid)),
        },
        canDiff && { label: t('doc.whatChanged'), onPress: () => onOpenDiff(f.path, snapshot.oid, f.status === 'added' ? null : parent) },
        { label: t('doc.history'), onPress: () => onShowHistory(f.path) },
      ],
    });
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.flex, { backgroundColor: c.bg, padding: 20 }]} testID="snapshot-sheet">
        <View style={s.grabber} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={[s.snapIcon, { backgroundColor: snapshot.kind === 'star' ? '#ffb938' : c.accentSoft }]}>
            <Icon name={kindIcon(snapshot.kind)} size={22} color={snapshot.kind === 'star' ? '#fff' : c.accent} weight="semibold" />
          </View>
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

        {aiFile ? (
          <AiButton
            c={c}
            title={t('ai.whatChanged')}
            sub={aiFile.path.split('/').pop()}
            style={{ marginTop: 18 }}
            onPress={() => onOpenDiff(aiFile.path, snapshot.oid, aiFile.status === 'added' ? null : parent, true)}
          />
        ) : files ? (
          <AiHint c={c} status={aiStatus} style={{ marginTop: 16 }} />
        ) : null}

        {reportFiles.length ? (
          <Jelly onPress={sendReport} scaleTo={0.97} style={{ marginTop: 12 }} disabled={!!busy} accessibilityLabel={t('report.send')} testID="send-report-button">
            <Glass c={c} interactive tint={c.accent + '22'} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <View style={[s.aiIcon, { backgroundColor: c.accentSoft }]}>
                <Icon name="paperplane.fill" size={15} color={c.accent} weight="semibold" />
              </View>
              <View style={s.flex}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{t('report.send')}</Text>
                <Text style={{ color: c.text2, fontSize: 12.5, marginTop: 2 }} numberOfLines={2}>{t('report.sub')}</Text>
              </View>
              <Text style={{ color: c.text3, fontSize: 20 }}>›</Text>
            </Glass>
          </Jelly>
        ) : null}

        <Text style={[s.dayHeader, { color: c.text3, marginTop: 22 }]}>{t('snapshot.changed')}</Text>
        {files === null ? <SkeletonRows c={c} rows={2} /> : null}
        <ScrollView>
          {(files || []).map((f) => {
            const delta = sdelta[f.path];
            const removed = f.status === 'removed';
            const kind = kindOf(f.path);
            const canDiff = !removed && (kind === 'word' || kind === 'text');
            const Card = removed ? View : Jelly; // silinmiş dosyada dokunulacak bir şey yok
            return (
              <Card key={f.path} {...(removed ? {} : { scaleTo: 0.98, onPress: () => fileActions(f, canDiff), onLongPress: () => fileActions(f, canDiff) })}>
                <Glass c={c} style={[s.tlItem, { marginBottom: 12, flexWrap: 'wrap', padding: 16 }]}>
                  <FileBadge name={f.path} size={40} />
                  <View style={s.flex}>
                    <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{f.path.split('/').pop()}</Text>
                    <Text style={{ color: c.text3, fontSize: 12, marginTop: 2 }}>
                      {removed ? t('snapshot.removed') : f.status === 'added' ? t('snapshot.added') : t('snapshot.modified')}
                      {delta ? ` · ${t('words.count', { n: (delta > 0 ? '+' : '') + num(delta), count: Math.abs(delta) })}` : ''}
                    </Text>
                  </View>
                  {!removed ? (
                    <Pressable hitSlop={12} onPress={() => fileActions(f, canDiff)} accessibilityLabel={t('doc.share')}>
                      <Text style={{ color: c.text3, fontSize: 22, fontWeight: '800', paddingHorizontal: 4 }}>···</Text>
                    </Pressable>
                  ) : null}
                  {!removed && !canDiff ? (
                    <Text style={{ color: c.text3, fontSize: 12, lineHeight: 16, width: '100%', marginTop: 10 }}>
                      {t(kind === 'pdf' ? 'snapshot.noDiffPdf' : kind === 'image' ? 'snapshot.noDiffImage' : 'snapshot.noDiffOther')}
                    </Text>
                  ) : null}
                  {!removed ? (
                    <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 14 }}>
                      {canDiff ? (
                        <Jelly style={s.flex} onPress={() => onOpenDiff(f.path, snapshot.oid, f.status === 'added' ? null : parent)}>
                          <View style={[s.actionBtn, s.btnRow, { backgroundColor: c.greenSoft }]}>
                            <Icon name="arrow.left.arrow.right" size={15} color={c.green} weight="semibold" />
                            <Text style={{ color: c.green, fontWeight: '800', fontSize: 15 }}>{t('snapshot.diff')}</Text>
                          </View>
                        </Jelly>
                      ) : null}
                      <Jelly style={s.flex} onPress={() => onOpenFile(f.path, snapshot.oid, snapshot.time)}>
                        <View style={[s.actionBtn, s.btnRow, { backgroundColor: c.accentSoft }]}>
                          <Icon name="doc.text" size={15} color={c.accent} weight="semibold" />
                          <Text style={{ color: c.accent, fontWeight: '800', fontSize: 15 }}>{t('snapshot.thisVersion')}</Text>
                        </View>
                      </Jelly>
                    </View>
                  ) : null}
                </Glass>
              </Card>
            );
          })}
          {files && files.length === 0 ? <EmptyState c={c} icon={kindIcon(snapshot.kind)} title={t('empty.noChanges')} body={t('snapshot.noFiles')} /> : null}
        </ScrollView>
      </View>
      {worker.element}
      <BusyHud c={c} text={busy} />
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
  const [busy, setBusy] = useState(null);
  const [uploading, setUploading] = useState(false);
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
  const openItem = (it) => setViewer({ name: it.name, subtitle: `Drive · ${ago(it.modified)}`, size: it.size, aiId: `drive:${it.id}:${it.modified}`, load: () => drive.download(it.id) });
  const itemActions = (it) =>
    showActions(c, {
      title: it.name,
      actions: [
        { label: t('doc.preview'), onPress: () => openItem(it) },
        { label: t('doc.share'), onPress: () => shareDoc(setBusy, it.name, () => drive.download(it.id)) },
      ],
    });

  // Telefondan dosya ekleme: bu klasöre yüklenir, masaüstü bir sonraki eşitlemede alır
  const addFiles = async () => {
    let picked;
    try {
      picked = await pickFiles();
    } catch (e) {
      Alert.alert(t('upload.failedTitle'), e.message);
      return;
    }
    if (!picked.length) return;
    const tooBig = picked.filter((a) => a.size > MAX_UPLOAD);
    const ok = picked.filter((a) => a.size <= MAX_UPLOAD);
    tooBig.forEach(discardPicked);
    if (tooBig.length) {
      warn();
      Alert.alert(t('upload.tooBigTitle'), tooBig.map((a) => (a.sizeUnknown ? t('upload.sizeUnknown', { name: a.name }) : t('upload.tooBig', { name: a.name, size: mb(a.size) }))).join('\n\n'), [{ text: t('common.ok') }]);
    }
    if (!ok.length) return;
    setUploading(true);
    const n = ok.length;
    const island = pulse({ icon: 'arrow.up.circle', color: '#38bdf8', title: n === 1 ? ok[0].name : current.name, subtitle: t('upload.progress', { i: 1, n }), short: t('upload.progressShort', { i: 1, n }) }, 180000);
    const taken = new Set((items || []).map((it) => it.name));
    const done = [];
    let failure = null;
    for (let i = 0; i < n; i++) {
      const a = ok[i];
      if (i > 0) island.update({ subtitle: t('upload.progress', { i: i + 1, n }), short: t('upload.progressShort', { i: i + 1, n }) });
      try {
        const name = await uniqueName(safeName(a.name), async (candidate) => taken.has(candidate));
        const bytes = await readBytes(a);
        await drive.upload(current.id, name, bytes, a.mimeType || fileType(name).mimeType);
        taken.add(name);
        done.push(name);
      } catch (e) {
        failure = e;
        if (e.auth) break;
      } finally {
        discardPicked(a);
      }
    }
    setUploading(false);
    if (done.length) {
      success();
      island.finish({ icon: 'checkmark.circle.fill', color: '#4ade80', title: done.length === 1 ? t('upload.doneOne', { name: done[0] }) : t('upload.doneMany', { n: done.length }), subtitle: t('upload.doneSub'), short: t('upload.doneShort') }, 5000);
      await load();
    } else island.finish({ icon: 'exclamationmark.triangle', color: '#f87171', subtitle: failure ? failure.message : '', short: t('upload.failedShort') });
    if (failure) {
      warn();
      if (failure.auth) onAuthError();
      else Alert.alert(t('upload.failedTitle'), failure.message, [{ text: t('common.ok') }]);
    }
  };

  return (
    <View style={s.flex}>
      <ScrollView style={s.flex} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 30, paddingHorizontal: 18 }}>
        <ScreenHeader
          c={c}
          onBack={back}
          backLabel={stack.length > 1 ? stack[stack.length - 2].name : t('nav.projects')}
          right={!isVersions && items ? <AddButton c={c} onPress={addFiles} busy={uploading} /> : null}
          look={isVersions ? { colors: DRIVE_LOOK.colors, icon: 'clock.arrow.circlepath' } : DRIVE_LOOK}
          eyebrow={t('drive.eyebrow')}
          title={isVersions ? t('drive.versions') : current.name}
          subtitle={isVersions ? t('drive.versionsSub') : items ? `Google Drive · ${t('drive.itemCount', { n: items.length, count: items.length })}` : 'Google Drive'}
        />
        {error ? <Text style={{ color: c.red }}>{error}</Text> : null}
        {items === null && !error ? <SkeletonRows c={c} rows={5} /> : null}
        {(isVersions ? [...(items || [])].sort((a, b) => (a.folder === b.folder ? b.name.localeCompare(a.name) : a.folder ? -1 : 1)) : items || []).map((it) => (
          <Jelly
            key={it.id}
            scaleTo={0.98}
            style={{ marginBottom: 8 }}
            onPress={() => (it.folder ? setStack([...stack, it]) : openItem(it))}
            onLongPress={it.folder ? undefined : () => itemActions(it)}
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
        {items && items.length === 0 ? <EmptyState c={c} icon="folder" title={t('empty.folder')} body={t('drive.empty')} /> : null}
        {items && items.some((it) => !it.folder) ? <Text style={{ color: c.text3, fontSize: 12, textAlign: 'center', marginTop: 16 }}>{t('docs.longPressHint')}</Text> : null}
      </ScrollView>
      <ViewerSheet c={c} target={viewer} onClose={() => setViewer(null)} />
      <BusyHud c={c} text={busy} />
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
  const [busy, setBusy] = useState(null);
  const bufRef = useRef(null);
  // PDF önizlemesi için önbelleğe yazılan geçici dosya (görüntüleyici kapanınca silinir)
  const tempFile = useRef(null);
  const dropTemp = () => {
    const f = tempFile.current;
    tempFile.current = null;
    try {
      if (f && f.exists) f.delete();
    } catch (e) {}
  };
  // Cihaz üstü Apple Intelligence
  const aiStatus = useAiStatus();
  const webRef = useRef(null);
  const textWaiter = useRef(null);
  const aiReq = useRef(0);
  const [diffInfo, setDiffInfo] = useState(null); // diffHtml'in gönderdiği { text, add, rem, first }
  const [ai, setAi] = useState(null); // AiPanel durumu

  useEffect(() => {
    if (!target) return;
    setSource(null);
    setError(null);
    setReady(false);
    setDiffInfo(null);
    setAi(null);
    aiReq.current++;
    textWaiter.current = null;
    bufRef.current = null;
    dropTemp();
    let alive = true;
    (async () => {
      try {
        if (target.diff) {
          const [oldBuf, newBuf, libs] = await Promise.all([target.diff.loadOld(), target.diff.loadNew(), loadViewerLibs(LIBS_FOR.diff)]);
          if (!alive) return;
          bufRef.current = newBuf;
          setSource({ html: diffHtml(oldBuf ? arrayBufferToBase64(oldBuf) : null, arrayBufferToBase64(newBuf), kindOf(target.name), c.dark, viewerLabels(), libs) });
          return;
        }
        // Büyük dosyalarda indirme durumu Dinamik Ada'da (uygulamadan çıksan da görünür)
        const big = (target.size || 0) > 700 * 1024;
        const island = big ? pulse({ icon: 'arrow.down.circle', color: '#38bdf8', title: target.name, subtitle: t('pulse.downloading'), short: t('pulse.downloadingShort') }, 60000) : null;
        const kind = kindOf(target.name);
        const libsJob = LIBS_FOR[kind] ? loadViewerLibs(LIBS_FOR[kind]) : Promise.resolve(null);
        let buf;
        try {
          buf = await target.load();
        } catch (e) {
          if (island) island.finish({ icon: 'exclamationmark.triangle', color: '#f87171', subtitle: t('pulse.failed'), short: t('pulse.failedShort') });
          throw e;
        }
        if (island) island.finish({ icon: 'checkmark.circle.fill', color: '#4ade80', subtitle: t('pulse.ready'), short: t('pulse.readyShort') });
        if (!alive) return;
        bufRef.current = buf;
        const libs = await libsJob;
        if (!alive) return;
        if (kind === 'pdf') {
          // Çok MB'lık base64 data: adresi WebView'ı çökertiyor; dosyaya yazıp dosya adresinden aç
          // (iOS WebView PDF'i yerel olarak çizer).
          const dir = new Directory(Paths.cache, 'Onizleme');
          dir.create({ intermediates: true, idempotent: true });
          const file = new File(dir, `${Date.now()}.pdf`);
          file.write(new Uint8Array(buf));
          tempFile.current = file;
          setSource({ uri: file.uri, readAccess: dir.uri });
          return;
        }
        const b64 = arrayBufferToBase64(buf);
        if (kind === 'word') setSource({ html: wordHtml(b64, c.dark, viewerLabels(), libs) });
        else if (kind === 'sheet') setSource({ html: sheetHtml(b64, c.dark, viewerLabels(), libs) });
        else if (kind === 'image') setSource({ image: `data:image/${target.name.split('.').pop().toLowerCase()};base64,${b64}` });
        else if (kind === 'text') setSource({ html: textHtml(utf8Decode(buf), c.dark, viewerLabels()) });
        else setError(t('viewer.unsupported'));
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => {
      alive = false;
      dropTemp();
    };
  }, [target]);

  // WebView'dan görünen metni iste (belge özeti için). 'ready' mesajının davranışı değişmez.
  const getDocText = () =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        textWaiter.current = null;
        resolve('');
      }, 4000);
      textWaiter.current = (text) => {
        clearTimeout(timer);
        textWaiter.current = null;
        resolve(text);
      };
      if (!webRef.current) return textWaiter.current('');
      webRef.current.injectJavaScript(
        "(function(){var t='';try{t=(document.body&&document.body.innerText)||'';}catch(e){}window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'text',text:t.slice(0,60000)}));})();true;"
      );
    });

  const onWebMessage = (e) => {
    const data = e && e.nativeEvent ? e.nativeEvent.data : '';
    if (typeof data === 'string' && data[0] === '{') {
      let m = null;
      try {
        m = JSON.parse(data);
      } catch (err) {}
      if (m && m.type === 'diff') return setDiffInfo(m);
      if (m && m.type === 'text') return textWaiter.current && textWaiter.current(String(m.text || ''));
    }
    setReady(true);
  };

  const runAi = async (mode) => {
    if (!target) return;
    const id = ++aiReq.current;
    const title = mode === 'doc' ? t('ai.summaryTitle') : t('ai.changesTitle');
    setAi({ mode, title, status: 'loading', points: mode === 'doc' ? [] : null });
    try {
      let result;
      if (mode === 'doc') {
        const text = await getDocText();
        result = await summarizeDocument(target.aiId || target.name, target.name, text);
      } else {
        result = { text: await summarizeChanges(target.aiId || target.name, target.name, diffInfo) };
      }
      if (id !== aiReq.current) return;
      success();
      setAi({ mode, title, status: 'done', ...result });
    } catch (err) {
      if (id !== aiReq.current) return;
      warn();
      setAi({ mode, title, status: 'error', error: aiErrorText(err) });
    }
  };

  // Kayıt ayrıntısındaki "Neler değişti?" ile açıldıysa özet kendiliğinden başlar
  useEffect(() => {
    if (target && target.autoAi && diffInfo && diffInfo.text && aiStatus === 'available' && !ai) runAi('diff');
  }, [diffInfo, aiStatus]);

  if (!target) return null;
  const aiOn = aiStatus === 'available' && ready && !!source && !error;
  const canDoc = aiOn && !!source.html && !target.diff;
  const canDiff = aiOn && !!target.diff && !!diffInfo && !!diffInfo.text;
  const share = () => shareDoc(setBusy, target.shareName || target.name, () => (bufRef.current ? Promise.resolve(bufRef.current) : target.diff ? target.diff.loadNew() : target.load()));
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
            <Jelly onPress={share} scaleTo={0.9} accessibilityLabel={t('viewer.share')}>
              <View style={[s.pillBtn, { backgroundColor: c.accentSoft }]}>
                <Text style={{ color: c.accent, fontWeight: '700', fontSize: 14 }}>{t('viewer.share')}</Text>
              </View>
            </Jelly>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: c.accent, fontWeight: '700', fontSize: 16 }}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
        {error ? (
          <View style={s.center}>
            <Icon name="exclamationmark.triangle.fill" size={36} color={c.text3} />
            <Text style={{ color: c.text2, marginTop: 8, textAlign: 'center', paddingHorizontal: 30 }}>{error}</Text>
          </View>
        ) : source && source.image ? (
          <ScrollView contentContainerStyle={{ padding: 16 }} maximumZoomScale={4}>
            <Image source={{ uri: source.image }} style={{ width: '100%', aspectRatio: 1, borderRadius: 12 }} resizeMode="contain" />
          </ScrollView>
        ) : source ? (
          <View style={s.flex}>
            <WebView
              ref={webRef}
              source={source.html ? { html: source.html, baseUrl: 'https://draftrewind.local/' } : { uri: source.uri }}
              allowingReadAccessToURL={source.readAccess}
              originWhitelist={['*']}
              style={{ flex: 1, backgroundColor: c.bg }}
              onMessage={onWebMessage}
              onLoadEnd={() => source.uri && setReady(true)}
            />
            {!ready ? (
              <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: c.bg }]}>
                <ActivityIndicator color={c.accent} size="large" />
                <Text style={{ color: c.text2, marginTop: 12 }}>{t('viewer.preparing')}</Text>
              </View>
            ) : null}
            {(canDoc || canDiff) && !ai ? (
              <View style={s.aiFloat} pointerEvents="box-none">
                <AiButton c={c} compact title={canDoc ? t('ai.summarize') : t('ai.whatChanged')} onPress={() => runAi(canDoc ? 'doc' : 'diff')} style={s.aiShadow} />
              </View>
            ) : null}
            {ai ? (
              <AiPanel
                c={c}
                ai={ai}
                onRetry={() => runAi(ai.mode)}
                onClose={() => {
                  aiReq.current++;
                  setAi(null);
                }}
              />
            ) : null}
          </View>
        ) : (
          <View style={s.center}>
            <ActivityIndicator color={c.accent} size="large" />
            <Text style={{ color: c.text2, marginTop: 12 }}>{t('viewer.downloading')}</Text>
          </View>
        )}
      </View>
      <BusyHud c={c} text={busy} />
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
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secBtn: { height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  codeBox: { width: 34, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  accountIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  projRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  projTile: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  backPill: { gap: 4, paddingLeft: 9, maxWidth: 220 },
  headBlock: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 14 },
  headTile: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  bar: { width: '100%', maxWidth: 30, borderRadius: 8 },
  seg: { flexDirection: 'row', padding: 4, marginBottom: 6, borderRadius: 16 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  pillBtn: { height: 32, borderRadius: 16, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 44, borderRadius: 14 },
  actionBtn: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  snapIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dayHeader: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  tlItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 },
  node: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 999 },
  grabber: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#8886', alignSelf: 'center', marginBottom: 12 },
  aiBtn: { minHeight: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 8 },
  aiPanel: { position: 'absolute', left: 12, right: 12, bottom: 28, maxHeight: '74%' },
  aiIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  aiDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  aiShadow: { shadowColor: '#6c5cff', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  aiFloat: { position: 'absolute', left: 0, right: 0, bottom: 30, alignItems: 'center' },
  viewerHead: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
