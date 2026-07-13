// Ícones de navegação — mesmo estilo line-icon (24x24, stroke currentColor) usado
// nos ícones de tema (Sun/Moon/System) do Layout.jsx. currentColor deixa o ícone
// herdar a cor do item ativo do menu, o que emoji não faz.
function Icon({ children, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

export function IconClipboardList(props) {
  return (
    <Icon {...props}>
      <path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z" />
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <line x1="9" y1="11" x2="15" y2="11" />
      <line x1="9" y1="15" x2="15" y2="15" />
      <line x1="9" y1="19" x2="12" y2="19" />
    </Icon>
  )
}

export function IconTrophy(props) {
  return (
    <Icon {...props}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 5H5a2 2 0 0 0 0 4h2" />
      <path d="M17 5h2a2 2 0 0 1 0 4h-2" />
      <line x1="12" y1="13" x2="12" y2="18" />
      <path d="M9 21h6" />
      <path d="M9 21c0-1.5.6-2.2 1.5-3h3c.9.8 1.5 1.5 1.5 3" />
    </Icon>
  )
}

export function IconTable(props) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="14" rx="1" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="10" y1="10" x2="10" y2="19" />
    </Icon>
  )
}

export function IconFlame(props) {
  return (
    <Icon {...props}>
      <path d="M12 22a6 6 0 0 0 6-6c0-3-2-4-3-7-1 2-1 3-3 3s-2-2-1-4c-3 2-5 5-5 8a6 6 0 0 0 6 6z" />
    </Icon>
  )
}

export function IconTarget(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function IconPodium(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="14" width="5" height="7" rx="1" />
      <rect x="9.5" y="9" width="5" height="12" rx="1" />
      <rect x="16" y="16" width="5" height="5" rx="1" />
    </Icon>
  )
}

export function IconUsers(props) {
  return (
    <Icon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  )
}

export function IconCrown(props) {
  return (
    <Icon {...props}>
      <path d="M4 18h16" />
      <path d="M4 18l-1.2-9 5.2 4 4-7 4 7 5.2-4-1.2 9" />
    </Icon>
  )
}

export function IconBallot(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="7" width="18" height="14" rx="1" />
      <path d="M3 7l9-4 9 4" />
      <path d="M9 13l2 2 4-4" />
    </Icon>
  )
}

export function IconCircleUser(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 19a5.5 5.5 0 0 1 11 0" />
    </Icon>
  )
}

export function IconFileText(props) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </Icon>
  )
}

export function IconBookOpen(props) {
  return (
    <Icon {...props}>
      <path d="M2 6a2 2 0 0 1 2-2h4a4 4 0 0 1 4 4 4 4 0 0 1 4-4h4a2 2 0 0 1 2 2v12a1 1 0 0 1-1 1h-5a3 3 0 0 0-3 1 3 3 0 0 0-3-1H3a1 1 0 0 1-1-1V6z" />
      <line x1="12" y1="8" x2="12" y2="20" />
    </Icon>
  )
}

export function IconNewspaper(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="14" height="16" rx="1" />
      <path d="M17 8h3a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H7" />
      <line x1="7" y1="9" x2="13" y2="9" />
      <line x1="7" y1="13" x2="13" y2="13" />
      <line x1="7" y1="17" x2="11" y2="17" />
    </Icon>
  )
}

export function IconLayoutDashboard(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="8" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="11" width="7" height="10" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </Icon>
  )
}

export function IconBarChart(props) {
  return (
    <Icon {...props}>
      <line x1="4" y1="21" x2="20" y2="21" />
      <line x1="4" y1="21" x2="4" y2="3" />
      <rect x="7" y="13" width="3" height="8" />
      <rect x="12" y="9" width="3" height="12" />
      <rect x="17" y="5" width="3" height="16" />
    </Icon>
  )
}

export function IconHistory(props) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </Icon>
  )
}

export function IconSettings(props) {
  return (
    <Icon {...props}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="14" cy="6" r="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="8" cy="12" r="2" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="16" cy="18" r="2" />
    </Icon>
  )
}
