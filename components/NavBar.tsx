import LogoMark from '@/components/LogoMark'

interface NavBarProps {
  onLogoClick?: () => void
}

export default function NavBar({ onLogoClick }: NavBarProps) {
  return (
    <header className="sticky top-0 z-[100] flex items-center justify-between h-[60px] px-5 bg-white/[.92] backdrop-blur-[12px] border-b border-line">
      <button
        className="nav-logo-btn flex items-center gap-[9px] px-2 py-[6px] rounded-md text-primary"
        onClick={onLogoClick}
        aria-label="FamilyBrief — go to home"
      >
        <LogoMark />
        <span className="text-[17px] font-bold tracking-[-0.3px] text-ink">FamilyBrief</span>
      </button>
    </header>
  )
}
