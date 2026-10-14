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
  onClose?: () => void;
  onPrintBill: () => void;
  onSkip: () => void;
  total?: string | number;
  formatPrice?: (price: number) => string;
};

export default function BillPrompt({
  visible,
  onClose,
  onPrintBill,
  onSkip,
  total = 0,
  formatPrice,
}: Props) {
  if (!visible) return null;

  const numericTotal = typeof total === "string" ? parseFloat(total) || 0 : total;
  const displayTotal = formatPrice
    ? formatPrice(numericTotal)
    : `$${numericTotal.toFixed(2)}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose || onSkip}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Receipt Icon Circle */}
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>🧾</Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>Print Receipt?</Text>

          {/* Amount */}
          <Text style={styles.amount}>Total: {displayTotal}</Text>

          {/* Message */}
          <Text style={styles.message}>
            Do you want to print a physical bill or generate a digital receipt for this transaction?
          </Text>

          {/* Buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={onSkip}
              activeOpacity={0.75}
            >
              <Text style={styles.skipBtnText}>No, Skip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.printBtn}
              onPress={onPrintBill}
              activeOpacity={0.85}
            >
              <Text style={styles.printBtnText}>Yes, Print Bill</Text>
            </TouchableOpacity>
          </View>

          {/* Note */}
          <Text style={styles.note}>Receipt is also automatically logged in Sales Reports</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff7ed",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  iconText: {
    fontSize: 34,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },
  amount: {
    fontSize: 26,
    fontWeight: "900",
    color: "#ea580c",
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
    fontWeight: "500",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    marginBottom: 16,
  },
  skipBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
  skipBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#4b5563",
  },
  printBtn: {
    flex: 1.3,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#f97316",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  printBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
  },
  note: {
    fontSize: 11,
    color: "#9ca3af",
    fontWeight: "600",
    textAlign: "center",
  },
});
