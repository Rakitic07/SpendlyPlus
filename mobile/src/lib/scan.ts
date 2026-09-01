import { PermissionsAndroid, Platform } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { parseBill, type ParsedBill } from './billParser';

export type ScanResult = {
  parsed: ParsedBill;
  thumbnail: string | null; // base64 JPEG data URL, ~100–500KB
  rawText: string;
};

// Target a 100–500KB thumbnail: crisp enough to read the whole receipt when
// enlarged, still modest for the DB. base64 grows ~4/3, so chars ≈ bytes * 4/3.
// THUMB_MAX_CHARS must stay under the server's validation cap (validation.ts,
// 700k) so a generated thumbnail always saves.
const THUMB_MAX_CHARS = 683000; // ~500KB — hard cap; a full photo never reaches DB
const THUMB_MIN_CHARS = 137000; // ~100KB — preferred floor (best-effort)

function stripScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

// We declare CAMERA in the manifest, so react-native-image-picker requires us to
// hold the runtime permission before launchCamera (Android 6+). Request it here.
async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const perm = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (await PermissionsAndroid.check(perm)) return true;
  const res = await PermissionsAndroid.request(perm, {
    title: 'Camera permission',
    message: 'Spendly-Plus needs the camera to scan your bill.',
    buttonPositive: 'Allow',
    buttonNegative: 'Cancel',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

async function makeThumbnail(uri: string): Promise<string | null> {
  // Keep the dimension generous and step DOWN quality in fine increments. We
  // pick the highest-quality render that still fits under the ~500KB cap —
  // which is the largest (clearest) image allowed and normally lands above the
  // ~100KB floor. `best` remembers the largest under-cap result as a safety net
  // if a later (smaller) attempt is all that succeeds.
  const attempts: [number, number][] = [
    [1400, 92],
    [1250, 90],
    [1100, 88],
    [950, 84],
    [820, 78],
    [700, 70],
    [560, 62],
    [460, 54],
    [360, 46],
  ];
  let best: string | null = null;
  for (const [size, quality] of attempts) {
    try {
      const resized = await ImageResizer.createResizedImage(
        uri,
        size,
        size,
        'JPEG',
        quality,
        0,
        undefined,
        false,
        { mode: 'contain', onlyScaleDown: true },
      );
      const b64 = await RNFS.readFile(stripScheme(resized.uri), 'base64');
      const dataUrl = `data:image/jpeg;base64,${b64}`;
      // Best-effort cleanup of the temp resized file.
      RNFS.unlink(stripScheme(resized.uri)).catch(() => {});
      if (dataUrl.length <= THUMB_MAX_CHARS) {
        // First under-cap result (highest quality) is the biggest allowed. If
        // it clears the ~15KB floor, take it; otherwise keep it as a fallback
        // and let a slightly higher-quality-but-smaller image win is impossible
        // here (we go high→low), so just return it.
        if (!best) best = dataUrl;
        if (dataUrl.length >= THUMB_MIN_CHARS) return dataUrl;
        // Under the floor already — smaller attempts only shrink further, so
        // this is as close to the band as we'll get.
        return best;
      }
    } catch {
      // This size failed (e.g. a content:// quirk) — fall through and try the
      // next smaller size rather than giving up on the thumbnail entirely.
      continue;
    }
  }
  return best; // may be null if every attempt failed — skip rather than bloat
}

// Capture (or pick) a bill photo, OCR it on-device, and parse fields. The full
// photo is used only transiently for OCR/thumbnail and is never persisted.
export async function scanBill(source: 'camera' | 'library'): Promise<ScanResult | null> {
  const options = {
    mediaType: 'photo' as const,
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.8 as const,
    includeBase64: false,
    saveToPhotos: false,
  };

  if (source === 'camera' && !(await ensureCameraPermission())) {
    throw new Error('Camera permission is required to scan a bill.');
  }

  const res =
    source === 'camera' ? await launchCamera(options) : await launchImageLibrary(options);

  if (res.didCancel) return null;
  if (res.errorCode) {
    throw new Error(res.errorMessage || 'Could not open the camera.');
  }
  const uri = res.assets?.[0]?.uri;
  if (!uri) throw new Error('No image captured.');

  // OCR is best-effort and must never lose the thumbnail (or block the add): if
  // ML Kit fails on a particular image we swallow the error, keep an empty
  // rawText, and still convert the photo so the user gets a preview and can type
  // the details in manually.
  let rawText = '';
  try {
    const ocr = await TextRecognition.recognize(uri);
    rawText = ocr.text ?? '';
  } catch {
    rawText = '';
  }
  const parsed = parseBill(rawText);
  const thumbnail = await makeThumbnail(uri);

  return { parsed, thumbnail, rawText };
}
