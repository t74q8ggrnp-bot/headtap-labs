import { Suspense } from "react";
import HomeClient from "./HomeClient";
import TerminalRouteLoading from "@/app/components/ui/TerminalRouteLoading";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <Suspense fallback={<TerminalRouteLoading label="Loading Spot Momentum" />}>
      <HomeClient
        surface="intelligence"
        initialMomentumPayload={null}
        initialBeforeCrowdPayload={null}
      />
    </Suspense>
  );
}
