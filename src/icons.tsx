const paths = {
  book: <><path d="M3 5.5c4-.7 6 .1 9 2 3-1.9 5-2.7 9-2v13c-4-.7-6 .1-9 2-3-1.9-5-2.7-9-2z"/><path d="M12 7.5v13"/></>,
  moon: <path d="M20.4 15.5A8.8 8.8 0 0 1 8.5 3.6 8.8 8.8 0 1 0 20.4 15.5Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/></>,
  left: <path d="m12 5-7 7 7 7M5 12h14"/>,
  right: <path d="m12 5 7 7-7 7m7-7H5"/>,
  shuffle: <><path d="M3 6h2c4 0 5 12 9 12h6M3 18h2c4 0 5-12 9-12h6"/><path d="m17 3 3 3-3 3m0 6 3 3-3 3"/></>,
  swap: <path d="M5 8h14m-4-4 4 4-4 4m4 4H5m4-4-4 4 4 4"/>,
  article: <><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8m-4-4v8"/></>,
  verb: <path d="m13 2-8 12h6l-1 8 9-12h-6l1-8Z"/>,
  adjective: <><path d="M12 3c.8 5 4 8.2 9 9-5 .8-8.2 4-9 9-.8-5-4-8.2-9-9 5-.8 8.2-4 9-9Z"/><path d="M19 3v4m-2-2h4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  cross: <path d="m6 6 12 12M18 6 6 18"/>,
  retry: <><path d="M4 11a8 8 0 1 1 1.6 6M4 5v6h6"/></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></>,
}

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
