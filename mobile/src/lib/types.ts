export type Expense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  paidBy: string;
  date: string; // ISO string
  notes: string | null;
  paymentMode: string | null; // Cash | UPI | Card
  paymentDetail: string | null; // provider/bank, e.g. "Google Pay", "HDFC"
  // Tiny base64 JPEG data URL of a scanned bill (preview only), or null.
  // List/bootstrap payloads omit this (it's heavy); `hasThumbnail` flags its
  // existence and the image is fetched lazily / restored from cache.
  thumbnail?: string | null;
  // True when the server has a bill image for this row even if `thumbnail` isn't
  // loaded on this device (e.g. scanned elsewhere).
  hasThumbnail?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseDraft = {
  title: string;
  category: string;
  amount: number;
  paidBy: string;
  date: string; // YYYY-MM-DD
  notes?: string;
  paymentMode?: string;
  paymentDetail?: string;
  thumbnail?: string; // base64 JPEG data URL, capped ~10KB
};
