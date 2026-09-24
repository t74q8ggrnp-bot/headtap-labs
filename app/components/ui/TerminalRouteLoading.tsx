import Image from "next/image";

export default function TerminalRouteLoading({ label = "Loading verified workspace" }: { label?: string }) {
  return (
    <div className="ht-terminal-route-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="ht-terminal-route-loading__rail" aria-hidden="true">
        <Image src="/logo.png" alt="" width={2909} height={1959} priority />
        <span />
        <span />
        <span />
      </div>
      <div className="ht-terminal-route-loading__chart" aria-hidden="true">
        <span className="ht-terminal-route-loading__pulse" />
      </div>
      <div className="ht-terminal-route-loading__message">
        <Image src="/app-icon.png" alt="" width={64} height={64} priority />
        <strong>HT LABS</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
