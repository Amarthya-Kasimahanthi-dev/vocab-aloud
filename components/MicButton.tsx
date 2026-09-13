"use client";

export default function MicButton({
  listening,
  disabled,
  onClick,
}: {
  listening: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={listening ? "mic mic-live" : "mic"}
      disabled={disabled}
      onClick={onClick}
      aria-label={listening ? "Stop and submit my answer" : "Answer out loud"}
      aria-pressed={listening}
    >
      {listening ? (
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" fill="currentColor" />
        </svg>
      ) : (
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <rect x="9" y="2.5" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3.5" />
        </svg>
      )}
    </button>
  );
}
