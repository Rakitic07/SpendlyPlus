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
  // List/bootstrap payloads omit this (it's heavy) and instead set
  // `hasThumbnail`; the actual image is re-attached from cache or fetched lazily.
  thumbnail?: string | null;
  // True when the server has a bill image for this row, even if `thumbnail`
  // isn't loaded yet on this device. Used to show a "has bill" hint and to
  // decide whether to lazily fetch the preview when the row is opened.
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
