// Dinamik Ada + kilit ekranı etkinliği (kısa bildirimler).
// 'widget' yönergeli fonksiyonlar ayrı bir çalışma ortamında (widget eklentisinde) çalışır:
// hook, state ya da async kullanılamaz; i18n de içe aktarılamaz. Çevrilmiş metinler props ile gelir.
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

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

export const PulseActivity = createLiveActivity('PulseActivity', PulseLayout);
export default PulseActivity;
