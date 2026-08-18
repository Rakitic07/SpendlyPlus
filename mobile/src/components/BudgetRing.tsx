import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, font } from '../theme';

export function BudgetRing({
  size = 132,
  stroke = 12,
  pct,
  centerTop,
  centerMain,
  centerSub,
}: {
  size?: number;
  stroke?: number;
  pct: number; // 0..1+
  centerTop?: string;
  centerMain: string;
  centerSub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const dash = c * clamped;
  const over = pct > 1;
  const ringColor = over ? colors.red : pct > 0.85 ? colors.amber : colors.green;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.primary} />
            <Stop offset="1" stopColor={colors.primary2} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.track}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? colors.red : 'url(#ring)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[styles.center, { paddingHorizontal: stroke + 6 }]}>
        {centerTop ? (
          <Text style={styles.top} numberOfLines={1}>
            {centerTop}
          </Text>
        ) : null}
        <Text
          style={[styles.main, { color: ringColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {centerMain}
        </Text>
        {centerSub ? (
          <Text style={styles.sub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {centerSub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  top: { color: colors.textFaint, fontSize: font.tiny, fontWeight: '600' },
  main: { fontSize: font.h2, fontWeight: '800', marginTop: 2 },
  sub: { color: colors.textDim, fontSize: font.tiny, marginTop: 2 },
});
