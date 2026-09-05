import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import QRCode from 'qrcode';
import { colors, radius } from '../theme/tokens';

interface Props {
  upiId: string;
  payeeName: string;
  amountInr: number;
  size?: number;
}

// Renders a scannable UPI QR encoding a `upi://pay` deep link — any UPI app
// (GPay, PhonePe, Paytm, ...) recognizes this scheme and opens straight into a
// pre-filled payment to `upiId` for `amountInr`. Generated client-side (via the
// `qrcode` package, canvas-based) so it always reflects the current
// app_settings values with no image to keep in sync.
export function PaymentQrCode({ upiId, payeeName, amountInr, size = 220 }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!upiId) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    const upiUri =
      `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}` +
      `&am=${amountInr}&cu=INR&tn=${encodeURIComponent('ReelSpark registration')}`;

    QRCode.toDataURL(upiUri, { width: size * 2, margin: 1, color: { dark: '#09090B', light: '#FFFFFF' } })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [upiId, payeeName, amountInr, size]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {dataUrl ? (
        <Image source={{ uri: dataUrl }} style={{ width: size - 24, height: size - 24 }} />
      ) : (
        <ActivityIndicator color={colors.pink} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
