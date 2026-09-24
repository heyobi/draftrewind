// Dinamik Ada + kilit ekranı etkinlikleri.
// 'widget' yönergeli fonksiyonlar ayrı bir çalışma ortamında (widget eklentisinde) çalışır:
// hook, state ya da async kullanılamaz; i18n de içe aktarılamaz. Çevrilmiş metinler props ile gelir.
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

// Odak modu: yazma seansı geri sayımı.
// Not: SwiftUI zamanlayıcı metni genişliğini kendisi belirleyemez; sabit genişlik verilmezse
// Dinamik Ada'nın dar alanında kırpılıp görünmez olur.
const FocusLayout = (props) => {
  'widget';
  const range = { lower: new Date(props.startAt), upper: new Date(props.endAt) };
  const accent = '#a99dff';
  const caption = props.caption || 'Odak modu · DraftRewind';
  const label = props.label || 'Odak';
  return {
    banner: (
      <HStack modifiers={[padding({ all: 16 })]}>
        <Image systemName="pencil.and.scribble" color={accent} />
        <VStack alignment="leading">
          <Text modifiers={[font({ weight: 'bold', size: 16 })]}>{props.title}</Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle('#9e9cb8')]}>{caption}</Text>
        </VStack>
        <Spacer />
        <Text timerInterval={range} countsDown modifiers={[font({ weight: 'bold', size: 30 }), monospacedDigit(), foregroundStyle(accent), frame({ width: 96, alignment: 'trailing' })]} />
      </HStack>
    ),
    compactLeading: <Image systemName="pencil.and.scribble" color={accent} />,
    compactTrailing: (
      <Text timerInterval={range} countsDown modifiers={[font({ weight: 'semibold', size: 14 }), monospacedDigit(), foregroundStyle(accent), frame({ width: 46, alignment: 'trailing' })]} />
    ),
    minimal: <Image systemName="timer" color={accent} />,
    expandedLeading: (
      <VStack alignment="leading" modifiers={[padding({ leading: 6 })]}>
        <Image systemName="pencil.and.scribble" color={accent} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle('#9e9cb8')]}>{label}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <Text timerInterval={range} countsDown modifiers={[font({ weight: 'bold', size: 26 }), monospacedDigit(), foregroundStyle(accent), frame({ width: 86, alignment: 'trailing' })]} />
    ),
    expandedBottom: <Text modifiers={[font({ size: 14, weight: 'medium' })]}>{props.title}</Text>,
  };
};

// Kısa bildirim: "3 yeni kayıt geldi", "Tez.docx indiriliyor / hazır". Birkaç saniye görünüp kaybolur.
const PulseLayout = (props) => {
  'widget';
  const color = props.color || '#a99dff';
  return {
    banner: (
      <HStack modifiers={[padding({ all: 16 })]}>
        <Image systemName={props.icon} color={color} />
        <VStack alignment="leading">
          <Text modifiers={[font({ weight: 'bold', size: 16 })]}>{props.title}</Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle('#9e9cb8')]}>{props.subtitle}</Text>
        </VStack>
        <Spacer />
      </HStack>
    ),
    compactLeading: <Image systemName={props.icon} color={color} />,
    compactTrailing: <Text modifiers={[font({ weight: 'semibold', size: 13 }), foregroundStyle(color), frame({ maxWidth: 70 })]}>{props.short}</Text>,
    minimal: <Image systemName={props.icon} color={color} />,
    expandedLeading: <Image systemName={props.icon} color={color} modifiers={[padding({ leading: 6, top: 6 })]} />,
    expandedTrailing: <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(color)]}>{props.short}</Text>,
    expandedBottom: (
      <VStack alignment="leading">
        <Text modifiers={[font({ weight: 'semibold', size: 15 })]}>{props.title}</Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle('#9e9cb8')]}>{props.subtitle}</Text>
      </VStack>
    ),
  };
};

export const FocusActivity = createLiveActivity('FocusActivity', FocusLayout);
export const PulseActivity = createLiveActivity('PulseActivity', PulseLayout);
export default FocusActivity;
