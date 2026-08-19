import Image from "next/image";

export default function Loading() {
  return (
    <div className="ht-route-loading" role="status" aria-label="Loading HT Labs">
      <Image src="/app-icon.png" alt="" width={112} height={112} priority className="ht-route-loading-logo" />
      <p className="ht-route-loading-name">HT LABS</p>
      <p className="ht-route-loading-copy">Loading market intelligence</p>
      <span className="ht-route-loading-bar" />
    </div>
  );
}
