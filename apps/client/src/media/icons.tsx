import type { ReactElement } from 'react';

const PATHS = {
  mic: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z',
  cam: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z',
  screen: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6z',
  gear: 'M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.4h-4L10.7 6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 2.6h4l.3-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  speaker: 'M3 9v6h4l5 4V5L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  rooms: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  people: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v2h16v-2c0-3.3-4.7-5-8-5z',
  chat: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  hand: 'M9 3.5a1.5 1.5 0 0 1 3 0V9h1V4.5a1.5 1.5 0 0 1 3 0V9h1V6.5a1.5 1.5 0 0 1 3 0V15c0 4-3 7-7 7-2.7 0-4.4-1.1-5.8-3.1l-3-4.6a1.4 1.4 0 0 1 2.2-1.6L7 14.2V5.5a1.5 1.5 0 0 1 2 0z',
  shirt: 'M9 3 3 6l2 4 2-1v12h10V9l2 1 2-4-6-3a3 3 0 0 1-6 0z',
  key: 'M7 14a4 4 0 1 1 3.9-5H22v3h-2v2h-3v-2h-6.1A4 4 0 0 1 7 14zm0-5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  power: 'M11 2h2v10h-2zm6.4 3.6a8 8 0 1 1-10.8 0L8 7a6 6 0 1 0 8 0z',
  star: 'M12 2l3 6.3 7 .9-5.1 4.8 1.3 6.9L12 17.5l-6.2 3.4 1.3-6.9L2 9.2l7-.9z',
  contrast: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2v14a7 7 0 0 1 0-14z',
  pencil: 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z',
  tv: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-5l1 3H8l1-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8h14V7z',
  list: 'M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z',
  chevron: 'M7 10l5 5 5-5z',
  /** Cracha (Meu perfil): cartao com cordao, cabeca e ombros vazados (enrolamento invertido). */
  user: 'M9 2h6v3H9zM4 7h16v14H4zM12 10.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5zM16.5 19c0-2-3-2.7-4.5-2.7s-4.5.7-4.5 2.7z',
  /** Bolo de aniversario (ficha, no dia). */
  cake: 'M11 2h2v3h-2zM4 12h16v3c-1.3 0-1.7-1-2.7-1s-1.4 1-2.7 1-1.7-1-2.6-1-1.4 1-2.6 1-1.7-1-2.6-1-1.4 1-2.7 1zm0 4.5c1 0 1.5.8 2.7.8s1.7-.8 2.6-.8 1.5.8 2.6.8 1.7-.8 2.6-.8 1.5.8 2.7.8V21H4zM6 8h12v3H6z',
  up: 'M12 6l9 11H3z',
  down: 'M12 18 3 7h18z',
  snow: 'M11 2h2v20h-2zM2.7 7l1-1.7 17.6 10.2-1 1.7zM2.7 17 20.3 6.800l1 1.700L3.700 18.700z',
  leaf: 'M20 3C10 3 4.500 8.500 4.500 15c0 1.500.4 2.800 1.100 3.900C7 14.500 11 11 15.500 9.800 11 12 8 16 6.800 20.500c1.100.4 2.300.6 3.500.6C17 21 20.500 15 20 3z',
  wind: 'M3 8h11a2.500 2.500 0 1 0-2.500-2.500h2A.5.5 0 1 1 14 6H3zm0 4h16a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zm0 4h8v2H3z',
  auto: 'M12 3 4 21h3l1.600-4h6.800l1.600 4h3zm-2.600 11L12 7.500 14.600 14z',
  timer: 'M9 2h6v2H9zm3 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v4.600l3 1.800-1 1.600-4-2.400V9z',
  calendar: 'M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zM5 9v10h14V9zm2 2h3v3H7zm5 0h3v3h-3z',
  swing: 'M3 5h18v2.500H3zm0 5.500 18 3.500v2.500L3 13zM3 18h18v2.500H3z',
} as const;

export function Icon({ name, off = false, size = 18 }: { name: keyof typeof PATHS; off?: boolean; size?: number }): ReactElement {
  return (
    <svg className="wvm-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="currentColor" />
      {off && <path d="M4 3.5 20.5 20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />}
    </svg>
  );
}
