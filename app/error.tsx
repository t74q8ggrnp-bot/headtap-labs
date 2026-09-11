"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Control, StatusState } from "@/app/components/ui/ApplicationPrimitives";

export default function ApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application route error", error);
  }, [error]);

  return (
    <main className="grid min-h-[70dvh] place-items-center bg-[#050505] px-5 py-12 text-white">
      <StatusState
        title="This page is temporarily unavailable"
        description="Your data and settings were not changed. Try the page again or return to HT Labs."
        tone="negative"
        className="w-full max-w-xl"
        action={(
          <div className="flex flex-wrap gap-3">
            <Control variant="primary" onClick={reset}>Try again</Control>
            <Link href="/" className="ht-control" data-variant="secondary" data-size="medium">Return home</Link>
          </div>
        )}
      />
    </main>
  );
}
