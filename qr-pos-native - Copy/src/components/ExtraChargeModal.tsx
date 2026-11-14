import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type Props = {
  visible: boolean;
  /** Payment method label shown in the subtitle, e.g. "CASH" */
  paymentMethod?: string;
  /** Order subtotal before the extra charge */
  subtotal: number;
  /** The extra fee amount */
  extraCharge: number;
  /** Called when user taps Cancel */
  onCancel: () => void;
  /** Called when user taps Confirm & Pay */
  onConfirm: () => void;
  /** Optional currency formatter, defaults to $X.XX */
  formatPrice?: (amount: number) => string;
};

export default function ExtraChargeModal({
  visible,
  paymentMethod = "CASH",
  subtotal,
  extraCharge,
  onCancel,
  onConfirm,
  formatPrice,
}: Props) {
  const fmt = (n: number) =>
    formatPrice ? formatPrice(n) : `$${n.toFixed(2)}`;

  const total = subtotal + extraCharge;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Close × button */}
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onCancel}
            hitSlop={10}
            activeOpacity={0.7}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>

          {/* Lightning bolt icon */}
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>⚡</Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>Extra Charge Notice</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Choosing{" "}
            <Text style={styles.subtitleBold}>{paymentMethod}</Text> incurs an
            extra fee
          </Text>

          {/* Breakdown card */}
          <View style={styles.breakdownCard}>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Order Subtotal:</Text>
              <Text style={styles.breakdownValue}>{fmt(subtotal)}</Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={styles.extraLabel}>
                Extra Charge ({paymentMethod}):
              </Text>
              <Text style={styles.extraValue}>+{fmt(extraCharge)}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.breakdownRow}>
              <Text style={styles.totalLabel}>Total Payable:</Text>
              <Text style={styles.totalValue}>{fmt(total)}</Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              activeOpacity={0.75}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={onConfirm}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmBtnText}>
                Confirm & Pay ({fmt(total)})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },

  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    paddingTop: 32,
    paddingBottom: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 12,
  },

  // Close button
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
    justifyContent: "center",
    alignItems: "center",
  },
  closeBtnText: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "700",
  },

  // Icon
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#fff7ed",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  iconEmoji: {
    fontSize: 30,
  },

  // Title / subtitle
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 20,
  },
  subtitleBold: {
    fontWeight: "900",
    color: "#111827",
  },

  // Breakdown card
  breakdownCard: {
    width: "100%",
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 24,
    gap: 10,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownLabel: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  breakdownValue: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "700",
  },
  extraLabel: {
    fontSize: 14,
    color: "#f97316",
    fontWeight: "600",
  },
  extraValue: {
    fontSize: 14,
    color: "#f97316",
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 2,
  },
  totalLabel: {
    fontSize: 16,
    color: "#111827",
    fontWeight: "900",
  },
  totalValue: {
    fontSize: 18,
    color: "#16a34a",
    fontWeight: "900",
  },

  // Buttons
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#4b5563",
  },
  confirmBtn: {
    flex: 2,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#16a34a",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#16a34a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
  },
});
