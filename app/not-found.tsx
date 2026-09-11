import Link from "next/link";
import { StatusState } from "@/app/components/ui/ApplicationPrimitives";

export default function NotFound() {
  return (
    <main className="grid min-h-[70dvh] place-items-center bg-[#050505] px-5 py-12 text-white">
      <StatusState
        title="Page not found"
        description="That HT Labs route is unavailable or may have moved."
        tone="warning"
        className="w-full max-w-xl"
        action={<Link href="/" className="ht-control" data-variant="primary" data-size="medium">Return home</Link>}
      />
    </main>
  );
}
