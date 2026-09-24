// SF Symbols ikonu (expo-symbols). Emoji yerine tek tip, temaya boyanan yerel ikonlar.
// SymbolView yoksa (ör. modül yüklenemediyse) aynı boyutta boş bir View döner — yerleşim kaymaz.
import React from 'react';
import { View } from 'react-native';

let SymbolView = null;
try {
  SymbolView = require('expo-symbols').SymbolView;
} catch (e) {
  SymbolView = null;
}

export function Icon({ name, size = 20, color, weight = 'medium', style }) {
  if (!name) return null;
  const box = { width: size, height: size };
  if (!SymbolView) return <View style={[box, style]} />;
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} resizeMode="scaleAspectFit" style={[box, style]} fallback={<View style={box} />} />;
}

export default Icon;
