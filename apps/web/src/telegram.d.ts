export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          start_param?: string;
        };
        ready: () => void;
        expand: () => void;
        colorScheme?: "light" | "dark";
        isFullscreen?: boolean;
        requestFullscreen?: () => void;
        exitFullscreen?: () => void;
        onEvent?: (eventType: string, callback: (...args: unknown[]) => void) => void;
        offEvent?: (eventType: string, callback: (...args: unknown[]) => void) => void;
        close?: () => void;
        openTelegramLink?: (url: string) => void;
        platform?: string;
        version?: string;
        BackButton?: {
          isVisible?: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        HapticFeedback?: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          selectionChanged: () => void;
        };
      };
    };
  }
}
