import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radius as radii, spacing } from '../theme';

// A lightweight shimmer skeleton. A translucent highlight sweeps left→right over
// a frosted base block. The sweep is a transform animation driven on the native
// thread (useNativeDriver), so it stays smooth without touching the JS thread.

let SHIMMER_SEQ = 0;

const SWEEP = 90;

export function Skeleton({
  width = '100%',
  height = 16,
  radius = 8,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const gradId = useMemo(() => `shimmer${SHIMMER_SEQ++}`, []);
  const [measured, setMeasured] = useState(typeof width === 'number' ? width : 0);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(x, {
        toValue: 1,
        duration: 1150,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [x]);

  const span = (measured || 160) + SWEEP;
  const translateX = x.interpolate({
    inputRange: [0, 1],
    outputRange: [-SWEEP, span],
  });

  return (
    <View
      onLayout={e => {
        if (typeof width !== 'number') setMeasured(e.nativeEvent.layout.width);
      }}
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.surface2, overflow: 'hidden' },
        style,
      ]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
        <Svg width={SWEEP} height={height}>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.16" />
              <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={SWEEP} height={height} fill={`url(#${gradId})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

// A single expense-row placeholder: round icon + two text lines + trailing amount.
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={42} height={42} radius={radii.md} />
      <View style={styles.rowMid}>
        <Skeleton width="62%" height={13} />
        <Skeleton width="40%" height={11} style={{ marginTop: 7 }} />
      </View>
      <Skeleton width={56} height={14} />
    </View>
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowMid: { flex: 1 },
});
