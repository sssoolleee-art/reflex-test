import { generateHapticFeedback } from '@apps-in-toss/web-framework';
import type { HapticFeedbackType } from '@apps-in-toss/web-framework';

// 토스 햅틱은 지원 환경에서만 동작, 아니면 조용히 무시
export function haptic(type: HapticFeedbackType) {
  try {
    void generateHapticFeedback({ type });
  } catch {
    // ignore
  }
}
