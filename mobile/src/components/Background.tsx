import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useNeo } from '../lib/themeMode';
import { neo } from '../theme';

// Mirrors the web Background (src/components/Background.tsx): a deep blue-black
// radial base plus three soft colour blobs (violet / pink / teal). Rendered once
// and static — essentially free — so the glass panels sit on the same backdrop
// as the website.
function BackgroundBase() {
  const { width, height } = useWindowDimensions();
  const isNeo = useNeo();

  // Neumorphism needs a flat page the raised surfaces can blend into.
  if (isNeo) return <View style={[styles.fill, { backgroundColor: neo.bg }]} pointerEvents="none" />;

  // Blob centres roughly match the web positions (top-left, right, bottom-left).
  const violet = { cx: width * 0.14, cy: height * 0.02, r: width * 0.62 };
  const pink = { cx: width * 1.02, cy: height * 0.16, r: width * 0.6 };
  const teal = { cx: width * 0.42, cy: height * 1.03, r: width * 0.66 };

  return (
    <View style={styles.fill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          {/* radial(125% 125% at 50% 10%, #0b1030 0%, #05060f 55%, #02030a 100%) */}
          <RadialGradient id="base" cx="50%" cy="8%" r="95%">
            <Stop offset="0" stopColor="#0b1030" />
            <Stop offset="0.55" stopColor="#05060f" />
            <Stop offset="1" stopColor="#02030a" />
          </RadialGradient>
          <RadialGradient id="violet" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#7c8cff" stopOpacity="0.30" />
            <Stop offset="1" stopColor="#7c8cff" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="pink" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ff6bd0" stopOpacity="0.24" />
            <Stop offset="1" stopColor="#ff6bd0" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="teal" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#38d9a9" stopOpacity="0.18" />
            <Stop offset="1" stopColor="#38d9a9" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={width} height={height} fill="url(#base)" />
        <Circle cx={violet.cx} cy={violet.cy} r={violet.r} fill="url(#violet)" />
        <Circle cx={pink.cx} cy={pink.cy} r={pink.r} fill="url(#pink)" />
        <Circle cx={teal.cx} cy={teal.cy} r={teal.r} fill="url(#teal)" />
      </Svg>
    </View>
  );
}

export const Background = React.memo(BackgroundBase);

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
